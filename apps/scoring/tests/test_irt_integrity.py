import pytest

from app.schemas.irt import IrtAnswer, IrtAttempt, IrtQuestion, IrtRequest
from app.services import irt as irt_service
from app.services.irt import IrtError, calculate_exam_irt


def answer(question_id: str, weight: float, score: float, correct: bool | None):
    return IrtAnswer(
        question_id=question_id,
        score=score,
        is_correct=correct,
        bank_questions=IrtQuestion(type="mcq", score_default=weight),
    )


def test_classical_irt_uses_question_weights_instead_of_item_count():
    request = IrtRequest(
        exam_id="exam",
        scoring_types=["irt_1pl"],
        attempts=[
            IrtAttempt(
                id="attempt",
                answers=[answer("heavy", 10, 10, True), answer("light", 2, 0, False)],
            )
        ],
    )

    result = calculate_exam_irt(request)

    assert result.attempts[0].detailed_scores["classical"] == 83.33


def test_unanswered_question_remains_in_classical_denominator():
    request = IrtRequest(
        exam_id="exam",
        scoring_types=["irt_1pl"],
        attempts=[
            IrtAttempt(
                id="attempt",
                answers=[answer("answered", 10, 10, True), answer("unanswered", 10, 0, None)],
            )
        ],
    )

    result = calculate_exam_irt(request)

    assert result.attempts[0].detailed_scores["classical"] == 50.0


def test_irt_rejects_pending_manual_grading():
    request = IrtRequest(
        exam_id="exam",
        scoring_types=["irt_1pl"],
        attempts=[IrtAttempt(id="attempt", needs_manual_grading=True)],
    )

    with pytest.raises(IrtError, match="belum dinilai"):
        calculate_exam_irt(request)


def test_zero_from_selected_highest_model_is_not_replaced(monkeypatch):
    monkeypatch.setattr(
        irt_service,
        "_theta_score",
        lambda _student, model, *_args: {"1pl": 40.0, "2pl": 20.0, "3pl": 0.0}[model],
    )
    request = IrtRequest(
        exam_id="exam",
        scoring_types=["irt_1pl", "irt_2pl", "irt_3pl"],
        attempts=[IrtAttempt(id="attempt", answers=[answer("q", 10, 0, False)])],
    )

    result = calculate_exam_irt(request)

    assert result.attempts[0].detailed_scores["irt_3pl"] == 0.0
    assert result.attempts[0].score_irt == 0.0


def test_small_irt_sample_returns_clear_model_warnings():
    request = IrtRequest(
        exam_id="exam",
        scoring_types=["irt_1pl", "irt_2pl"],
        attempts=[IrtAttempt(id="attempt", answers=[answer("q", 10, 10, True)])],
    )

    result = calculate_exam_irt(request)

    assert len(result.warnings) == 2
    assert "100 peserta" in result.warnings[0]
    assert "200 peserta" in result.warnings[1]


def test_irt_rejects_exam_without_objective_items():
    essay = IrtAnswer(
        question_id="essay",
        score=10,
        is_correct=True,
        bank_questions=IrtQuestion(type="essay", score_default=10),
    )
    request = IrtRequest(
        exam_id="exam",
        scoring_types=["irt_1pl"],
        attempts=[IrtAttempt(id="attempt", answers=[essay])],
    )

    with pytest.raises(IrtError, match="soal objektif"):
        calculate_exam_irt(request)


@pytest.mark.parametrize("model", ["irt_1pl", "irt_2pl", "irt_3pl"])
def test_irt_reports_signed_theta_and_preserves_classical_percentages(model):
    attempts = [IrtAttempt(id=str(correct), answers=[
        answer(f"q{i}", 1, float(i < correct), i < correct) for i in range(6)
    ]) for correct in [0, 3, 6]]
    result = calculate_exam_irt(IrtRequest(exam_id="exam", scoring_types=[model], attempts=attempts))
    low, middle, high = result.attempts
    assert result.score_scale == "theta"
    assert low.score_irt < middle.score_irt < high.score_irt
    assert low.score_irt < 0 < high.score_irt
    assert [row.detailed_scores["classical"] for row in result.attempts] == [0, 50, 100]
    assert all(row.score_irt == row.detailed_scores[model] for row in result.attempts)
    assert high.score_irt > 4, "Theta must not be clipped to the old display bounds"


def test_essay_points_are_not_blended_into_theta():
    objective = [answer("q1", 1, 1, True), answer("q2", 1, 0, False)]
    def calculate(essay_score):
        essay = IrtAnswer(question_id="essay", score=essay_score,
            bank_questions=IrtQuestion(type="essay", score_default=8))
        return calculate_exam_irt(IrtRequest(exam_id="exam", scoring_types=["irt_1pl"],
            attempts=[IrtAttempt(id="a", answers=[*objective, essay])])).attempts[0]
    low, high = calculate(0), calculate(8)
    assert low.score_irt == high.score_irt
    assert low.detailed_scores["classical"] == 10
    assert high.detailed_scores["classical"] == 90
