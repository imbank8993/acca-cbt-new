import json

import pytest

from app.schemas.grading import Question, QuestionOption, RelativeAttempt
from app.services.grading import apply_relative_scoring, calculate_single_answer_score


def question(kind, metadata=None):
    return Question(id="q", type=kind, score_default=10, metadata=metadata or {}, bank_question_options=[
        QuestionOption(id="a", is_correct=True, order=0, weight=2, metadata={"dimension_id": "d"}),
        QuestionOption(id="b", is_correct=True, order=1, weight=3, metadata={"dimension_id": "d"}),
    ])


@pytest.mark.parametrize("kind", ["mcq_complex", "checklist", "ranking", "ordering"])
@pytest.mark.parametrize("answer", [["a", "a"], ["a", "b", "a"], ["a", "foreign"]])
def test_duplicate_or_foreign_choices_never_gain_credit(kind, answer):
    result = calculate_single_answer_score(question(kind), json.dumps(answer))
    assert result.score == 0
    assert result.dimension_scores == {}
    assert result.is_correct is not True


def test_valid_complex_answer_remains_correct():
    assert calculate_single_answer_score(question("mcq_complex"), '["b","a"]').score == 10


def test_valid_checklist_keeps_weight_including_zero():
    q = question("checklist")
    q.bank_question_options[0].weight = 0
    result = calculate_single_answer_score(q, '["a","b"]')
    assert result.dimension_scores == {"d": 3}


def test_valid_ranking_keeps_rank_scores():
    result = calculate_single_answer_score(question("ranking"), '["b","a"]')
    assert result.dimension_scores == {"d": 3}


@pytest.mark.parametrize("kind,key", [("matching", "match_texts"), ("categorization", "category_names")])
def test_duplicate_pairing_cannot_replace_two_distinct_values(kind, key):
    q = Question(id="q", type=kind, score_default=10, bank_question_options=[
        QuestionOption(id="a", metadata={key: ["X", "Y"]})
    ])
    assert calculate_single_answer_score(q, '{"a":["X","X"]}').score == 0
    assert calculate_single_answer_score(q, '{"a":["Y","X"]}').score == 10


@pytest.mark.parametrize("kind", ["matching", "categorization", "checklist"])
def test_nested_malformed_values_do_not_crash_grading(kind):
    answer = '{"a":[{}]}' if kind != "checklist" else '[{}]'
    q = question(kind)
    if kind != "checklist":
        key = "match_texts" if kind == "matching" else "category_names"
        for option in q.bank_question_options:
            option.metadata = {key: ["X"]}
    assert calculate_single_answer_score(q, answer).score == 0


def test_relative_scoring_gives_equal_duration_equal_penalty():
    scores = apply_relative_scoring([
        RelativeAttempt(attempt_id="b", base_score=80, duration_seconds=60),
        RelativeAttempt(attempt_id="a", base_score=80, duration_seconds=60),
        RelativeAttempt(attempt_id="c", base_score=80, duration_seconds=61),
    ])
    assert scores == {"a": 80, "b": 80, "c": 79.99}


def test_short_answer_substring_does_not_receive_unintended_partial_credit():
    q = Question(
        id="q",
        type="short_answer",
        score_default=10,
        metadata={"blanks": [{"answer": "Jakarta", "variations": ["DKI Jakarta"]}]},
    )

    assert calculate_single_answer_score(q, '["a"]').score == 0
    assert calculate_single_answer_score(q, '["Jak"]').score == 0
    assert calculate_single_answer_score(q, '["DKI Jakarta"]').score == 10
