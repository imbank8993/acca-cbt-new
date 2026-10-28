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
    # EAP: skor sempurna/nol tetap menghasilkan θ terhingga dan simetris.
    assert abs(high.score_irt) < 5
    if model == "irt_1pl":
        assert middle.score_irt == 0
        assert high.score_irt == pytest.approx(-low.score_irt)


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


def student_with(correct_ids):
    return irt_service.StudentData(attempt_id="s", correct_item_ids=set(correct_ids))


def test_theta_uses_the_same_metric_as_item_difficulty():
    """1PL memakai D = 1 (b = logit), 2PL/3PL memakai D = 1,7 (normal-ogive).

    Dengan banyak butir, EAP mendekati solusi likelihood: 75% benar pada butir
    b = 0 berarti θ = ln 3 / D.
    """
    ids = [f"q{i}" for i in range(400)]
    zeros, ones = irt_service.np.zeros(400), irt_service.np.ones(400)
    student = student_with(ids[:300])
    rasch = irt_service._theta_score(student, "1pl", ids, ones, zeros, zeros)
    two_pl = irt_service._theta_score(student, "2pl", ids, ones, zeros, zeros)
    assert rasch == pytest.approx(irt_service.math.log(3), abs=0.03)
    assert two_pl == pytest.approx(irt_service.math.log(3) / 1.7, abs=0.02)
    # θ = b: peluang benar 50% pada model yang sama.
    half = irt_service._theta_score(student_with(ids[:200]), "1pl", ids, ones, ones * 0.8, zeros)
    assert half == pytest.approx(0.8, abs=0.02)


def test_three_pl_estimates_are_finite_below_chance():
    ids = [f"q{i}" for i in range(20)]
    zeros, ones = irt_service.np.zeros(20), irt_service.np.ones(20)
    guess = ones * 0.25
    below_chance = irt_service._theta_score(student_with(ids[:2]), "3pl", ids, ones, zeros, guess)
    chance = irt_service._theta_score(student_with(ids[:5]), "3pl", ids, ones, zeros, guess)
    assert -4 < below_chance <= chance < 0


def test_single_participant_still_gets_signed_estimate():
    ids = ["a", "b"]
    zeros, ones = irt_service.np.zeros(2), irt_service.np.ones(2)
    none = irt_service.np.zeros(2, dtype=bool)
    assert irt_service._theta_score(student_with([]), "1pl", ids, ones, zeros, zeros, none) < 0
    assert irt_service._theta_score(student_with(ids), "1pl", ids, ones, zeros, zeros, none) > 0


def simulated_request(model, seed=7, students=400, items=40):
    rng = irt_service.np.random.default_rng(seed)
    theta = rng.normal(0, 1, students)
    a = rng.uniform(0.7, 1.8, items) if model != "irt_1pl" else irt_service.np.ones(items)
    b = rng.uniform(-1.8, 1.8, items)
    d = irt_service.MODEL_D[model[-3:]]
    p = 1 / (1 + irt_service.np.exp(-d * a * (theta[:, None] - b[None, :])))
    responses = rng.random((students, items)) < p
    attempts = [IrtAttempt(id=str(n), answers=[
        answer(f"q{i:02d}", 1, float(responses[n, i]), bool(responses[n, i])) for i in range(items)
    ]) for n in range(students)]
    return IrtRequest(exam_id="sim", scoring_types=[model], attempts=attempts), theta, a, b, responses


@pytest.mark.parametrize("model", ["irt_1pl", "irt_2pl"])
def test_simulated_abilities_and_difficulties_are_recovered(model):
    request, theta, a, b, responses = simulated_request(model)
    result = calculate_exam_irt(request)
    estimated = irt_service.np.array([row.score_irt for row in result.attempts])
    item_b = irt_service.np.array([item.b for item in sorted(result.items, key=lambda item: item.item_id)])
    assert irt_service.np.corrcoef(estimated, theta)[0, 1] > 0.9
    assert irt_service.np.corrcoef(item_b, b)[0, 1] > 0.9
    # Satu metrik: θ peserta berpusat dekat 0 dengan sebaran mendekati 1.
    assert abs(float(estimated.mean())) < 0.2
    assert 0.8 < float(estimated.std()) < 1.15
    if model == "irt_1pl":
        # Rasch: skor mentah statistik cukup, urutan θ mengikuti jumlah benar.
        raw = responses.sum(axis=1)
        order = irt_service.np.argsort(raw, kind="stable")
        assert all(irt_service.np.diff(estimated[order]) >= -1e-6)
    else:
        item_a = irt_service.np.array([item.a for item in sorted(result.items, key=lambda item: item.item_id)])
        assert irt_service.np.corrcoef(item_a, a)[0, 1] > 0.5


def test_displayed_item_difficulty_follows_highest_model():
    request, *_ = simulated_request("irt_1pl", students=120, items=8)
    one = calculate_exam_irt(request).items
    request.scoring_types = ["irt_1pl", "irt_2pl"]
    two = calculate_exam_irt(request).items
    # Butir mudah tetap negatif, butir sulit tetap positif pada kedua metrik.
    for x, y in zip(one, two):
        assert (x.b < 0) == (y.b < 0) or abs(x.b) < 0.05
    assert [x.b for x in one] != [y.b for y in two]


def test_three_pl_recovers_parameters_when_answers_include_guessing():
    from app.schemas.irt import IrtOption
    rng = irt_service.np.random.default_rng(3)
    theta = rng.normal(0, 1, 400)
    a = rng.uniform(0.7, 1.8, 40)
    b = rng.uniform(-1.8, 1.8, 40)
    p = 0.2 + 0.8 / (1 + irt_service.np.exp(-1.7 * a * (theta[:, None] - b[None, :])))
    responses = rng.random(p.shape) < p
    options = [IrtOption(id=f"o{k}") for k in range(5)]
    attempts = [IrtAttempt(id=str(n), answers=[IrtAnswer(
        question_id=f"q{i:02d}", score=float(responses[n, i]), is_correct=bool(responses[n, i]),
        bank_questions=IrtQuestion(type="mcq", score_default=1, bank_question_options=options),
    ) for i in range(40)]) for n in range(400)]
    result = calculate_exam_irt(IrtRequest(exam_id="sim", scoring_types=["irt_3pl"], attempts=attempts))
    estimated = irt_service.np.array([row.score_irt for row in result.attempts])
    items = sorted(result.items, key=lambda item: item.item_id)
    item_b = irt_service.np.array([item.b for item in items])
    assert irt_service.np.sqrt(irt_service.np.mean((estimated - theta) ** 2)) < 0.4
    assert irt_service.np.sqrt(irt_service.np.mean((item_b - b) ** 2)) < 0.35
    assert all(item.c == pytest.approx(0.2) for item in items)
