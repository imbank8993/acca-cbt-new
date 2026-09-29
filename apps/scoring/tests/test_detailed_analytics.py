import pytest
from app.schemas.analytics import (
    DetailedAnswerInput,
    DetailedItemAnalysisRequest,
    DetailedOptionInput,
    DetailedParticipantInput,
    DetailedQuestionInput,
)
from app.services.analytics import build_detailed_item_analysis


def test_build_detailed_item_analysis_mcq():
    q1 = DetailedQuestionInput(
        id="q1",
        number=1,
        question_text="Berapa 1 + 1?",
        type="mcq",
        score_default=1.0,
        options=[
            DetailedOptionInput(id="opt1", option_text="2", is_correct=True, order=0),
            DetailedOptionInput(id="opt2", option_text="3", is_correct=False, order=1),
            DetailedOptionInput(id="opt3", option_text="4", is_correct=False, order=2),
        ],
    )
    p1 = DetailedParticipantInput(
        attempt_id="att1",
        student_name="Ahmad Budi",
        class_name="XII-A",
        total_score=100.0,
    )
    p2 = DetailedParticipantInput(
        attempt_id="att2",
        student_name="Citra Dewi",
        class_name="XII-B",
        total_score=0.0,
    )

    ans1 = DetailedAnswerInput(
        attempt_id="att1",
        question_id="q1",
        is_correct=True,
        score=1.0,
        selected_option_id="opt1",
    )
    ans2 = DetailedAnswerInput(
        attempt_id="att2",
        question_id="q1",
        is_correct=False,
        score=0.0,
        selected_option_id="opt2",
    )

    req = DetailedItemAnalysisRequest(
        exam_id="exam-123",
        questions=[q1],
        participants=[p1, p2],
        answers=[ans1, ans2],
    )

    res = build_detailed_item_analysis(req)
    assert res.total_questions == 1
    assert res.total_participants == 2
    item = res.items[0]
    assert item.id == "q1"
    assert item.total_correct == 1
    assert item.total_incorrect == 1
    assert len(item.correct_students) == 1
    assert item.correct_students[0].student_name == "Ahmad Budi"
    assert item.correct_students[0].display_answer.startswith("A. 2")
    assert len(item.wrong_students) == 1
    assert item.wrong_students[0].student_name == "Citra Dewi"
    assert item.wrong_students[0].display_answer.startswith("B. 3")

    # Check distractor stats
    assert len(item.distractor_distribution) == 3
    opt_a = next(o for o in item.distractor_distribution if o.option_letter == "A")
    assert opt_a.count == 1
    assert opt_a.student_names == ["Ahmad Budi"]
    opt_b = next(o for o in item.distractor_distribution if o.option_letter == "B")
    assert opt_b.count == 1
    assert opt_b.student_names == ["Citra Dewi"]

    # Check matrix
    assert len(res.matrix) == 2
    row1 = next(r for r in res.matrix if r.attempt_id == "att1")
    assert row1.items["q1"].status == "correct"
    assert row1.items["q1"].score == 1.0
    row2 = next(r for r in res.matrix if r.attempt_id == "att2")
    assert row2.items["q1"].status == "wrong"
    assert row2.items["q1"].score == 0.0
