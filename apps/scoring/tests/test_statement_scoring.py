"""Aturan penskoran Benar-Salah dan Kategorisasi.

Rujukan: Kepdirjen Pendis 781/2021 (Juknis Soal HOTS Madrasah) dan Desain
Pengembangan Soal AKM 2020. Satu soal dinilai sebagai satu soal:

* ≤ 5 pernyataan: semua benar → penuh, selain itu 0.
* > 5 pernyataan: semua benar → penuh, salah 1–2 → setengah, salah > 2 → 0.

Ujian lama bertanda ``complex_scoring = "proportional"`` tetap proporsional.
"""

from __future__ import annotations

import json

import pytest

from app.routers.grading import grade_attempt
from app.schemas.grading import GradeBatchRequest, Question, QuestionOption
from app.schemas.irt import IrtRequest
from app.services.grading import calculate_single_answer_score, statement_score_fraction
from app.services.irt import calculate_exam_irt

LEGACY = {"complex_scoring": "proportional"}


def true_false(count: int, metadata: dict | None = None, weight: float = 4) -> Question:
    return Question(
        id="q", type="true_false", score_default=weight, metadata=metadata or {},
        bank_question_options=[QuestionOption(id=f"s{i}", is_correct=i % 2 == 0) for i in range(count)],
    )


def tf_answer(count: int, wrong: int, blank: int = 0) -> str:
    """Jawaban dengan ``wrong`` pernyataan salah lalu ``blank`` pernyataan kosong."""
    answer: dict[str, bool] = {}
    for i in range(count):
        key = i % 2 == 0
        if i < wrong:
            answer[f"s{i}"] = not key
        elif i < wrong + blank:
            continue
        else:
            answer[f"s{i}"] = key
    return json.dumps(answer)


def categorization(count: int, metadata: dict | None = None) -> Question:
    cats = ["Hewan", "Tumbuhan", "Jamur"]
    return Question(
        id="q", type="categorization", score_default=4, metadata=metadata or {},
        bank_question_options=[
            QuestionOption(id=f"s{i}", metadata={"category_names": [cats[i % 3]]}) for i in range(count)
        ],
    )


def cat_answer(count: int, wrong: int) -> str:
    cats = ["Hewan", "Tumbuhan", "Jamur"]
    return json.dumps({f"s{i}": [cats[(i + (1 if i < wrong else 0)) % 3]] for i in range(count)})


@pytest.mark.parametrize("total,correct,expected", [
    (3, 3, 1.0), (3, 2, 0.0), (4, 4, 1.0), (4, 3, 0.0), (4, 0, 0.0),
    (5, 5, 1.0), (5, 4, 0.0),
    (6, 6, 1.0), (6, 5, 0.5), (6, 4, 0.5), (6, 3, 0.0),
    (8, 6, 0.5), (8, 5, 0.0), (0, 0, 0.0),
])
def test_statement_score_fraction(total, correct, expected):
    assert statement_score_fraction(total, correct) == expected


@pytest.mark.parametrize("count,wrong,score,correct", [
    (4, 0, 4, True), (4, 1, 0, False), (4, 2, 0, False),
    (6, 0, 4, True), (6, 1, 2, False), (6, 2, 2, False), (6, 3, 0, False),
])
def test_true_false_official_rule(count, wrong, score, correct):
    result = calculate_single_answer_score(true_false(count), tf_answer(count, wrong))
    assert result.score == score
    assert result.is_correct is correct


def test_true_false_blank_statement_counts_as_wrong():
    assert calculate_single_answer_score(true_false(4), tf_answer(4, 0, blank=1)).score == 0
    assert calculate_single_answer_score(true_false(6), tf_answer(6, 0, blank=2)).score == 2
    assert calculate_single_answer_score(true_false(6), tf_answer(6, 1, blank=2)).score == 0


@pytest.mark.parametrize("count,wrong,score", [(4, 0, 4), (4, 1, 0), (6, 1, 2), (6, 3, 0)])
def test_categorization_official_rule(count, wrong, score):
    result = calculate_single_answer_score(categorization(count), cat_answer(count, wrong))
    assert result.score == score
    assert result.is_correct is (wrong == 0)


def test_legacy_exams_keep_proportional_scoring():
    assert calculate_single_answer_score(true_false(4, LEGACY), tf_answer(4, 1)).score == 3
    assert calculate_single_answer_score(categorization(4, LEGACY), cat_answer(4, 1)).score == 3
    legacy = calculate_single_answer_score(true_false(4, LEGACY), tf_answer(4, 1))
    assert legacy.is_correct is False


def test_other_types_ignore_the_flag():
    question = Question(id="q", type="matching", score_default=4, metadata=LEGACY, bank_question_options=[
        QuestionOption(id="a", metadata={"match_text": "X"}), QuestionOption(id="b", metadata={"match_text": "Y"})])
    official = Question(**{**question.model_dump(), "metadata": {}})
    raw = json.dumps({"a": ["X"], "b": ["X"]})
    assert calculate_single_answer_score(question, raw).score == 2
    assert calculate_single_answer_score(official, raw).score == 2


def test_attempt_scale_uses_official_rule():
    result = grade_attempt(GradeBatchRequest(items=[
        {"question": true_false(6).model_dump(), "raw_answer": tf_answer(6, 1)},
        {"question": true_false(4).model_dump(), "raw_answer": tf_answer(4, 1)},
    ]))
    assert result.total_score == 2
    assert result.max_possible_score == 8
    assert result.scaled_score == 25


def _irt(question: Question, answers: list[str], model: str = "irt_3pl"):
    payload = question.model_dump()
    return calculate_exam_irt(IrtRequest.model_validate({
        "exam_id": "exam", "scoring_types": [model], "attempts": [
            {"id": f"a{i}", "answers": [{
                "question_id": "q", "essay_answer": raw,
                "score": calculate_single_answer_score(question, raw).score,
                "bank_questions": payload,
            }]} for i, raw in enumerate(answers)
        ]}))


def test_irt_counts_official_true_false_as_one_item():
    result = _irt(true_false(4), [tf_answer(4, 0), tf_answer(4, 1), tf_answer(4, 2)])
    assert [item.item_id for item in result.items] == ["q"]
    assert result.items[0].total == 3
    assert result.items[0].correct == 1
    assert result.items[0].c == pytest.approx(0.5**4, abs=1e-4)


def test_irt_half_credit_stays_in_classical_but_not_in_the_item():
    result = _irt(true_false(6), [tf_answer(6, 0), tf_answer(6, 1), tf_answer(6, 4)], model="irt_1pl")
    assert result.items[0].correct == 1
    classical = {a.id: a.detailed_scores["classical"] for a in result.attempts}
    assert classical == {"a0": 100, "a1": 50, "a2": 0}


def test_irt_categorization_guessing_uses_category_count():
    result = _irt(categorization(3), [cat_answer(3, 0), cat_answer(3, 1)])
    assert [item.item_id for item in result.items] == ["q"]
    assert result.items[0].c == pytest.approx((1 / 3) ** 3, abs=1e-4)


def test_irt_legacy_exam_still_unfolds_statements():
    result = _irt(true_false(3, LEGACY), [tf_answer(3, 0), tf_answer(3, 1)], model="irt_1pl")
    assert sorted(item.item_id for item in result.items) == ["q_s0", "q_s1", "q_s2"]


def _single_item(question: dict, raw: str, correct: bool):
    return calculate_exam_irt(IrtRequest.model_validate({
        "exam_id": "exam", "scoring_types": ["irt_3pl"], "attempts": [
            {"id": "a", "answers": [{"question_id": "q", "is_correct": correct, "score": 1 if correct else 0,
                                     "essay_answer": raw, "bank_questions": question}]},
            {"id": "b", "answers": [{"question_id": "q", "is_correct": not correct, "score": 0 if correct else 1,
                                     "essay_answer": raw, "bank_questions": question}]},
        ]})).items[0].c


@pytest.mark.parametrize("qtype,options,metadata,expected", [
    ("mcq", 5, {}, 1 / 5),
    ("mcq_complex", 4, {}, 1 / 15),
    ("mcq_complex", 5, {}, 1 / 31),
    ("short_answer", 0, {}, 0.0),
    ("ordering", 4, {}, 1 / 24),
    # Ujian lama: rumus lama dipertahankan.
    ("mcq_complex", 5, LEGACY, 1 / 5),
    ("short_answer", 0, LEGACY, 0.2),
    ("ordering", 4, LEGACY, 1 / 4),
])
def test_irt_guessing_parameter_per_type(qtype, options, metadata, expected):
    question = {"type": qtype, "score_default": 1, "metadata": metadata,
                "bank_question_options": [{"id": f"o{i}", "is_correct": i == 0} for i in range(options)]}
    assert _single_item(question, "", True) == pytest.approx(expected, abs=1e-4)
