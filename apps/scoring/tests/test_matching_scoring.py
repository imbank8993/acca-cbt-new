"""Pilihan aturan menjodohkan: nilai lama, pasangan kosong, bobot, dan IRT."""
import json
import pytest
from app.schemas.grading import Question, QuestionOption, GradeBatchRequest
from app.schemas.irt import IrtRequest
from app.routers.grading import grade_attempt
from app.services.grading import calculate_single_answer_score
from app.services.irt import calculate_exam_irt


def question(count=5, rule=None):
    return Question(id="match", type="matching", score_default=4,
        metadata={} if rule is None else {"matching_scoring": rule},
        bank_question_options=[QuestionOption(id=f"s{i}", metadata={"match_text": f"X{i}"}) for i in range(count)])


def answer(count=5, wrong=0, blank=0):
    return json.dumps({f"s{i}": ["wrong" if i < wrong else f"X{i}"]
        for i in range(count) if not wrong <= i < wrong + blank})


@pytest.mark.parametrize("rule,wrong,expected", [
    (None, 1, 3.2), ("proportional", 1, 3.2), ("official", 1, 0),
    (None, 0, 4), ("proportional", 0, 4), ("official", 0, 4),
    (None, 5, 0), ("official", 5, 0),
])
def test_five_pairs_score_with_exam_rule(rule, wrong, expected):
    result=calculate_single_answer_score(question(rule=rule), answer(wrong=wrong))
    assert result.score == pytest.approx(expected)
    assert result.is_correct is (wrong == 0)


@pytest.mark.parametrize("count,wrong,blank,expected", [
    (5,0,1,0), (6,0,1,2), (6,1,1,2), (6,1,2,0), (6,0,0,4),
])
def test_whole_question_rule_counts_blank_pairs_as_wrong(count,wrong,blank,expected):
    result=calculate_single_answer_score(question(count,"official"), answer(count,wrong,blank))
    assert result.score == expected
    assert result.is_correct is (wrong+blank == 0)


def test_whole_matching_does_not_award_empty_question_or_duplicate_targets():
    assert calculate_single_answer_score(question(0,"official"), "{}").score == 0
    assert calculate_single_answer_score(question(0,"official"), "{}").is_correct is False
    payload=json.loads(answer());payload["s0"]=["X0","X0"]
    assert calculate_single_answer_score(question(rule="official"),json.dumps(payload)).score == 0


def test_multiple_targets_must_all_match_within_one_pairing_row():
    q=question(2,"proportional")
    q.bank_question_options[0].metadata={"match_texts":["X","Y"]}
    assert calculate_single_answer_score(q,json.dumps({"s0":["X"],"s1":["X1"]})).score == 2
    assert calculate_single_answer_score(q,json.dumps({"s0":["Y","X"],"s1":["X1"]})).score == 4


def test_matching_rule_is_independent_of_true_false_legacy_flag():
    q=question(rule="official");q.metadata["complex_scoring"]="proportional"
    assert calculate_single_answer_score(q,answer(wrong=1)).score == 0
    q=question();q.metadata["complex_scoring"]="official"
    assert calculate_single_answer_score(q,answer(wrong=1)).score == pytest.approx(3.2)


def test_batch_total_uses_each_matching_rule_and_weight():
    result=grade_attempt(GradeBatchRequest(items=[
        {"question":question(rule="official").model_dump(),"raw_answer":answer(wrong=1)},
        {"question":question(rule="proportional").model_dump(),"raw_answer":answer(wrong=1)},
    ]))
    assert result.total_score == pytest.approx(3.2)
    assert result.max_possible_score == 8
    assert result.scaled_score == 40


@pytest.mark.parametrize("rule,model,expected_items", [
    ("official","irt_1pl",1), ("official","irt_2pl",1), ("official","irt_3pl",1),
    (None,"irt_1pl",5), ("proportional","irt_3pl",5),
])
def test_irt_whole_question_vs_legacy_pair_items(rule,model,expected_items):
    q=question(rule=rule)
    result=calculate_exam_irt(IrtRequest.model_validate({"exam_id":"exam","scoring_types":[model],"attempts":[
        {"id":f"a{i}","answers":[{"question_id":"match","essay_answer":raw,
            "score":calculate_single_answer_score(q,raw).score,"bank_questions":q.model_dump()}]}
        for i,raw in enumerate([answer(),answer(wrong=1),answer(wrong=3)])]}))
    assert len(result.items)==expected_items
    if rule == "official":
        assert result.items[0].item_id=="match"
        assert result.items[0].correct==1
        assert result.items[0].c==0
    assert {a.id:a.detailed_scores["classical"] for a in result.attempts} == (
        {"a0":100,"a1":0,"a2":0} if rule == "official" else {"a0":100,"a1":80,"a2":40})
