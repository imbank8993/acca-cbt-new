"""Opsi isian singkat "Bedakan huruf besar/kecil" (metadata.case_sensitive)."""

from app.schemas.analytics import DetailedAnswerInput, DetailedQuestionInput
from app.schemas.grading import Question
from app.services.answer_parser import normalize_short_answer, short_answer_case_sensitive
from app.services.grading import calculate_single_answer_score
from app.services.response_distribution import build_response_distribution


def _question(**metadata):
    return Question(
        id="q",
        type="short_answer",
        score_default=10,
        metadata={"blanks": [{"answer": "Jakarta", "variations": ["DKI Jakarta"]}], **metadata},
    )


def test_default_ignores_case_and_outer_spaces():
    q = _question()
    for answer in ('["Jakarta"]', '["jakarta"]', '["JAKARTA"]', '["  jakarta "]', '["dki jakarta"]'):
        assert calculate_single_answer_score(q, answer).score == 10, answer


def test_case_sensitive_requires_exact_capitals():
    q = _question(case_sensitive=True)
    assert calculate_single_answer_score(q, '["Jakarta"]').score == 10
    assert calculate_single_answer_score(q, '[" Jakarta "]').score == 10
    assert calculate_single_answer_score(q, '["DKI Jakarta"]').score == 10
    for wrong in ('["jakarta"]', '["JAKARTA"]', '["DKI jakarta"]'):
        result = calculate_single_answer_score(q, wrong)
        assert result.score == 0 and result.is_correct is False, wrong


def test_only_a_real_true_enables_case_sensitivity():
    assert short_answer_case_sensitive({"case_sensitive": True}) is True
    for metadata in ({}, {"case_sensitive": False}, {"case_sensitive": "true"}, {"case_sensitive": 1}, None):
        assert short_answer_case_sensitive(metadata) is False
    assert normalize_short_answer(" Co ") == "co"
    assert normalize_short_answer(" Co ", True) == "Co"


def test_response_distribution_follows_the_same_rule():
    def groups(**metadata):
        question = DetailedQuestionInput(id="q", type="short_answer",
                                         metadata={"blanks": [{"answer": "Co", "variations": []}], **metadata})
        answers = [DetailedAnswerInput(attempt_id=a, question_id="q", essay_answer=v)
                   for a, v in (("s1", '["Co"]'), ("s2", '["CO"]'), ("s3", '["co"]'))]
        group = build_response_distribution(question, [], {}, answers, {}, set(), set())[0]
        return sorted((c.value, c.count, c.is_key) for c in group.choices), round(group.correct_percentage)

    # Bawaan: "Co", "CO", "co" satu kelompok jawaban benar.
    assert groups() == ([("Co", 3, True)], 100)
    # Dibedakan: tiga kelompok, hanya "Co" yang benar.
    assert groups(case_sensitive=True) == ([("CO", 1, False), ("Co", 1, True), ("co", 1, False)], 33)
