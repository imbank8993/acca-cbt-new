"""Regression coverage for empty, malformed and zero-weight responses across models."""
import json

import pytest

from app.schemas.grading import GradeBatchRequest, Question, QuestionOption
from app.schemas.irt import IrtRequest
from app.routers.grading import grade_attempt
from app.services.grading import calculate_single_answer_score
from app.services.irt import calculate_exam_irt


@pytest.mark.parametrize('kind', ['true_false', 'matching', 'categorization', 'short_answer'])
@pytest.mark.parametrize('raw', [None, '', '{}', '[]'])
def test_empty_response_and_incomplete_key_never_earn_credit(kind, raw):
    question = Question(id='q', type=kind, score_default=10,
                        metadata={'blanks': [{'answer': '', 'variations': ['']}]},
                        bank_question_options=[QuestionOption(id='a')])
    result = calculate_single_answer_score(question, raw)
    assert result.score == 0
    assert result.is_correct is False


@pytest.mark.parametrize('value', [1, True, {}, [], None])
def test_non_text_short_answer_cannot_crash_or_match(value):
    question = Question(id='q', type='short_answer',
                        metadata={'blanks': [{'answer': 'Jakarta'}]})
    assert calculate_single_answer_score(question, json.dumps([value])).score == 0


def test_zero_weight_is_preserved_in_batch_numerator_and_denominator():
    result = grade_attempt(GradeBatchRequest.model_validate({'items': [
        {'question': {'id': 'zero', 'type': 'mcq', 'score_default': 0,
                      'bank_question_options': [{'id': 'a', 'is_correct': True}]}, 'raw_answer': 'a'},
        {'question': {'id': 'weighted', 'type': 'mcq', 'score_default': 10,
                      'bank_question_options': [{'id': 'b', 'is_correct': True}]}, 'raw_answer': None},
    ]}))
    assert result.total_score == 0
    assert result.max_possible_score == 10
    assert result.scaled_score == 0


@pytest.mark.parametrize('model', ['irt_1pl', 'irt_2pl', 'irt_3pl'])
def test_zero_weight_question_does_not_affect_irt_calibration(model):
    result = calculate_exam_irt(IrtRequest.model_validate({
        'exam_id': 'exam', 'scoring_types': [model], 'attempts': [{
            'id': 'attempt', 'answers': [
                {'question_id': 'zero', 'is_correct': True, 'score': 0,
                 'bank_questions': {'type': 'mcq', 'score_default': 0}},
                {'question_id': 'weighted', 'is_correct': False, 'score': 0,
                 'bank_questions': {'type': 'mcq', 'score_default': 10}},
            ]}]}))
    assert [item.item_id for item in result.items] == ['weighted']
    assert result.attempts[0].detailed_scores['classical'] == 0


@pytest.mark.parametrize('model', ['irt_1pl', 'irt_2pl', 'irt_3pl'])
@pytest.mark.parametrize('kind,key', [('matching', 'match_texts'), ('categorization', 'category_names')])
@pytest.mark.parametrize('selection,expected', [(['X', 'X'], 0), (['Y', 'X'], 1), ([{}], 0), (1, 0), (None, 0)])
def test_irt_pairing_uses_same_validity_rules_as_classical(model, kind, key, selection, expected):
    question = {'type': kind, 'score_default': 10,
                'bank_question_options': [{'id': 'a', 'metadata': {key: ['X', 'Y']}}]}
    raw = json.dumps({'a': selection})
    classical = calculate_single_answer_score(Question(id='q', **question), raw)
    result = calculate_exam_irt(IrtRequest.model_validate({
        'exam_id': 'exam', 'scoring_types': [model], 'attempts': [{
            'id': 'attempt', 'answers': [{'question_id': 'q', 'bank_questions': question,
                                         'essay_answer': raw, 'score': classical.score}]}]}))
    assert result.items[0].correct == expected
    assert result.attempts[0].detailed_scores['classical'] == expected * 100
    assert 0 <= result.attempts[0].detailed_scores[model] <= 100


@pytest.mark.parametrize('value,key,expected', [('benar', True, 1), ('salah', False, 1),
                                             (None, None, 0), (0, False, 0), (False, False, 1)])
def test_irt_true_false_matches_classical_and_deduplicates_options(value, key, expected):
    option = {'id': 'a', 'is_correct': key}
    result = calculate_exam_irt(IrtRequest.model_validate({
        'exam_id': 'exam', 'scoring_types': ['irt_1pl', 'irt_2pl', 'irt_3pl'], 'attempts': [{
            'id': 'attempt', 'answers': [{'question_id': 'q', 'essay_answer': json.dumps({'a': value}),
                'bank_questions': {'type': 'true_false', 'bank_question_options': [option, option]}}]}]}))
    assert len(result.items) == 1
    assert result.items[0].total == 1
    assert result.items[0].correct == expected
