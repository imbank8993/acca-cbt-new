"""Soal dibatalkan (metadata.score_excluded) tidak dihitung di mana pun."""
from app.routers.grading import grade_attempt
from app.schemas.grading import GradeBatchItem, GradeBatchRequest, Question, QuestionOption
from app.schemas.irt import IrtAnswer, IrtAttempt, IrtQuestion, IrtRequest
from app.services.irt import calculate_exam_irt


def mcq(question_id: str, excluded: bool = False) -> Question:
    return Question(
        id=question_id,
        type="mcq",
        score_default=1,
        metadata={"score_excluded": True} if excluded else {},
        bank_question_options=[
            QuestionOption(id=f"{question_id}-a", is_correct=True),
            QuestionOption(id=f"{question_id}-b", is_correct=False),
        ],
    )


def test_voided_question_is_removed_from_score_and_maximum():
    # 3 dari 4 soal; soal ke-4 dibatalkan dan dijawab salah.
    request = GradeBatchRequest(items=[
        GradeBatchItem(question=mcq("q1"), raw_answer="q1-a", answer_id="q1"),
        GradeBatchItem(question=mcq("q2"), raw_answer="q2-a", answer_id="q2"),
        GradeBatchItem(question=mcq("q3"), raw_answer="q3-b", answer_id="q3"),
        GradeBatchItem(question=mcq("q4", excluded=True), raw_answer="q4-b", answer_id="q4"),
    ])
    result = grade_attempt(request)
    assert result.max_possible_score == 3
    assert result.total_score == 2
    assert round(result.scaled_score, 2) == 66.67
    voided = next(item for item in result.items if item.question_id == "q4")
    assert voided.score == 0 and voided.is_correct is None


def test_correct_answer_on_voided_question_neither_helps_nor_hurts():
    base = [GradeBatchItem(question=mcq("q1"), raw_answer="q1-a", answer_id="q1")]
    right = grade_attempt(GradeBatchRequest(items=base + [
        GradeBatchItem(question=mcq("q2", excluded=True), raw_answer="q2-a", answer_id="q2")]))
    wrong = grade_attempt(GradeBatchRequest(items=base + [
        GradeBatchItem(question=mcq("q2", excluded=True), raw_answer="q2-b", answer_id="q2")]))
    assert right.scaled_score == wrong.scaled_score == 100


def test_voided_essay_does_not_wait_for_manual_grading():
    essay = Question(id="e1", type="essay", score_default=5, metadata={"score_excluded": True})
    result = grade_attempt(GradeBatchRequest(items=[
        GradeBatchItem(question=mcq("q1"), raw_answer="q1-a", answer_id="q1"),
        GradeBatchItem(question=essay, raw_answer="jawaban", answer_id="e1"),
    ]))
    assert result.needs_manual_grading is False
    assert result.max_possible_score == 1


def test_irt_ignores_voided_question():
    def answer(question_id, score, correct, excluded=False):
        return IrtAnswer(question_id=question_id, score=score, is_correct=correct,
                         bank_questions=IrtQuestion(type="mcq", score_default=10,
                                                    metadata={"score_excluded": True} if excluded else {}))
    result = calculate_exam_irt(IrtRequest(exam_id="exam", scoring_types=["irt_1pl"], attempts=[
        IrtAttempt(id="a", answers=[answer("kept", 10, True), answer("voided", 0, False, excluded=True)]),
    ]))
    assert result.attempts[0].detailed_scores["classical"] == 100.0
