import json
import pytest
from app.services.analytics import _difficulty_label
from app.schemas.analytics import (
    DetailedAnswerInput,
    DetailedItemAnalysisRequest,
    DetailedOptionInput,
    DetailedParticipantInput,
    DetailedQuestionInput,
)
from app.services.analytics import build_detailed_item_analysis


@pytest.mark.parametrize('p,label', [
    (0,'Sangat Sulit'),(.1,'Sangat Sulit'),(.100001,'Sulit'),(.3,'Sulit'),
    (.300001,'Sedang'),(.7,'Sedang'),(.700001,'Mudah'),(.9,'Mudah'),
    (.900001,'Sangat Mudah'),(1,'Sangat Mudah'),(None,''),(float('nan'),''),(-.1,''),(1.1,''),
])
def test_nonuniform_five_difficulty_bands(p,label):
    assert _difficulty_label(p) == label


def test_pending_grading_does_not_make_an_item_appear_more_difficult():
    question=DetailedQuestionInput(id='q',number=1,question_text='q',type='mcq')
    participants=[DetailedParticipantInput(attempt_id=str(i),student_name=str(i)) for i in range(100)]
    answers=[DetailedAnswerInput(attempt_id=str(i),question_id='q',is_correct=True if i<9 else False if i==9 else None) for i in range(100)]
    result=build_detailed_item_analysis(DetailedItemAnalysisRequest(exam_id='e',questions=[question],participants=participants,answers=answers))
    item=result.items[0]
    assert item.total_ungraded == 90
    assert item.difficulty_index == .9
    assert item.difficulty_label == 'Mudah'


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


# --- Soal berpernyataan: tampilkan huruf pernyataan, bukan ID internal (UUID) ---

UUID_A = "32171764-8093-43af-985e-92501a22b492"
UUID_B = "6a9fbc7b-c328-41f2-be92-2718cdc6967e"
UUID_C = "814d444e-a17d-4769-aa81-382d536cf772"


def _true_false_request(answer):
    question = DetailedQuestionInput(
        id="tf", number=22, question_text="Tentukan benar atau salah.", type="true_false",
        options=[
            DetailedOptionInput(id=UUID_A, option_text="<p>2 bilangan prima</p>", is_correct=True, order=0),
            DetailedOptionInput(id=UUID_B, option_text="9 bilangan prima", is_correct=False, order=1),
            DetailedOptionInput(id=UUID_C, option_text="1 bilangan prima", is_correct=False, order=2),
        ],
    )
    participants = [DetailedParticipantInput(attempt_id="a1", student_name="Ahmad")]
    answers = [DetailedAnswerInput(attempt_id="a1", question_id="tf", is_correct=False, essay_answer=answer)]
    return DetailedItemAnalysisRequest(exam_id="e", questions=[question], participants=participants, answers=answers)


def test_true_false_answer_uses_statement_letters_not_ids():
    result = build_detailed_item_analysis(_true_false_request({UUID_C: "benar", UUID_B: "salah", UUID_A: "salah"}))
    item = result.items[0]
    student = item.wrong_students[0]
    assert student.display_answer == "A: Salah, B: Salah, C: Benar"
    assert "-" not in [p.label for p in student.answer_parts]
    assert [(p.label, p.value, p.correct) for p in student.answer_parts] == [
        ("A", "Salah", False), ("B", "Salah", True), ("C", "Benar", False),
    ]
    for text in (student.display_answer, item.key_display):
        assert UUID_A not in text and UUID_B not in text and UUID_C not in text
    # Kunci per pernyataan, termasuk pernyataan yang kuncinya "Salah".
    assert item.key_display == "A: Benar, B: Salah, C: Salah"
    assert [(k.label, k.text, k.value) for k in item.key_parts] == [
        ("A", "2 bilangan prima", "Benar"), ("B", "9 bilangan prima", "Salah"), ("C", "1 bilangan prima", "Salah"),
    ]
    # Matriks siswa memakai format yang sama.
    assert result.matrix[0].items["tf"].display_answer == "A: Salah, B: Salah, C: Benar"


def _groups(item):
    return {g.label: g for g in item.response_distribution}


def _choices(group):
    return {c.value: c for c in group.choices}


def test_true_false_unanswered_statement_counts_as_wrong_and_feeds_the_distribution():
    result = build_detailed_item_analysis(_true_false_request(json.dumps({UUID_A: "benar"})))
    item = result.items[0]
    parts = item.wrong_students[0].answer_parts
    assert [(p.value, p.correct) for p in parts] == [("Benar", True), ("-", False), ("-", False)]
    groups = _groups(item)
    assert [g.kind for g in item.response_distribution] == ["statement"] * 3
    a = _choices(groups["A"])
    assert (a["Benar"].is_key, a["Benar"].count, a["Salah"].is_key, a["Salah"].count) == (True, 1, False, 0)
    assert groups["A"].correct_percentage == 100.0
    assert (groups["B"].empty, groups["B"].correct_percentage) == (1, 0.0)
    assert _choices(groups["B"])["Salah"].is_key


def test_categorization_key_comes_from_option_metadata():
    question = DetailedQuestionInput(
        id="cat", number=3, type="categorization",
        options=[
            DetailedOptionInput(id=UUID_A, option_text="Paus", order=0, metadata={"category_names": ["Mamalia"]}),
            DetailedOptionInput(id=UUID_B, option_text="Hiu", order=1, metadata={"category_name": "Ikan"}),
        ],
    )
    request = DetailedItemAnalysisRequest(
        exam_id="e", questions=[question],
        participants=[DetailedParticipantInput(attempt_id="a1", student_name="Budi")],
        answers=[DetailedAnswerInput(attempt_id="a1", question_id="cat", is_correct=False,
                                     essay_answer={UUID_A: ["Mamalia"], UUID_B: ["Mamalia"]})],
    )
    item = build_detailed_item_analysis(request).items[0]
    assert item.key_display == "A: Mamalia, B: Ikan"
    assert [(p.label, p.value, p.correct) for p in item.wrong_students[0].answer_parts] == [
        ("A", "Mamalia", True), ("B", "Mamalia", False),
    ]
    groups = _groups(item)
    # Hiu salah dikategorikan sebagai Mamalia: pengecoh yang menjebak terlihat di sebaran.
    b = _choices(groups["B"])
    assert (b["Mamalia"].count, b["Mamalia"].is_key, b["Ikan"].count, b["Ikan"].is_key) == (1, False, 0, True)
    assert [g.correct_percentage for g in item.response_distribution] == [100.0, 0.0]


def test_mcq_items_have_no_statement_parts():
    question = DetailedQuestionInput(id="q", type="mcq", options=[DetailedOptionInput(id="o1", option_text="x", is_correct=True)])
    request = DetailedItemAnalysisRequest(
        exam_id="e", questions=[question],
        participants=[DetailedParticipantInput(attempt_id="a1", student_name="C")],
        answers=[DetailedAnswerInput(attempt_id="a1", question_id="q", is_correct=True, selected_option_id="o1")],
    )
    item = build_detailed_item_analysis(request).items[0]
    assert item.key_parts == [] and item.correct_students[0].answer_parts == []
    assert [g.kind for g in item.response_distribution] == ["single"]


# --- Sebaran jawaban: daya beda per opsi dan penanda pengecoh (20 peserta, kelompok 27% = 5) ---

def _mcq_request(key: str):
    options = [DetailedOptionInput(id=o, option_text=f"opsi {o}", is_correct=o == key, order=i) for i, o in enumerate("ABCD")]
    question = DetailedQuestionInput(id="q", type="mcq", options=options)
    participants = [DetailedParticipantInput(attempt_id=f"a{i}", student_name=f"S{i:02d}", total_score=20 - i) for i in range(20)]
    pick = lambda i: "A" if i < 10 else "D" if i < 15 else "B"  # atas → A, bawah → B, C tidak dipilih
    answers = [DetailedAnswerInput(attempt_id=f"a{i}", question_id="q", is_correct=pick(i) == key, selected_option_id=pick(i)) for i in range(20)]
    return DetailedItemAnalysisRequest(exam_id="e", questions=[question], participants=participants, answers=answers)


def test_mcq_distribution_reports_option_discrimination_and_nonfunctional_distractors():
    group = build_detailed_item_analysis(_mcq_request("A")).items[0].response_distribution[0]
    c = _choices(group)
    assert (c["A"].percentage, c["A"].discrimination, c["A"].flags) == (50.0, 1.0, [])
    assert (c["B"].percentage, c["B"].discrimination) == (25.0, -1.0)
    assert (c["C"].count, c["C"].flags) == (0, ["nonfunctional"])
    assert c["D"].discrimination == 0.0 and c["D"].flags == []
    assert group.correct_percentage == 50.0


def test_mcq_distribution_flags_a_possible_miskey():
    c = _choices(build_detailed_item_analysis(_mcq_request("B")).items[0].response_distribution[0])
    assert "key_negative" in c["B"].flags  # kunci dipilih kelompok bawah
    assert "attracts_upper" in c["A"].flags  # pengecoh dipilih kelompok atas


def test_small_groups_do_not_report_discrimination():
    request = _mcq_request("A")
    request.participants = request.participants[:5]
    request.answers = request.answers[:5]
    c = _choices(build_detailed_item_analysis(request).items[0].response_distribution[0])
    assert c["A"].discrimination is None and "attracts_upper" not in c["B"].flags


def test_mcq_complex_counts_each_selected_option():
    options = [DetailedOptionInput(id=o, option_text=o, is_correct=o in "AC", order=i) for i, o in enumerate("ABC")]
    request = DetailedItemAnalysisRequest(
        exam_id="e", questions=[DetailedQuestionInput(id="q", type="mcq_complex", options=options)],
        participants=[DetailedParticipantInput(attempt_id=f"a{i}", student_name=f"S{i}") for i in range(2)],
        answers=[DetailedAnswerInput(attempt_id="a0", question_id="q", is_correct=True, essay_answer='["A","C"]'),
                 DetailedAnswerInput(attempt_id="a1", question_id="q", is_correct=False, essay_answer='["A"]')],
    )
    group = build_detailed_item_analysis(request).items[0].response_distribution[0]
    c = _choices(group)
    assert group.kind == "multi"
    assert (c["A"].count, c["A"].is_key, c["C"].count, c["C"].is_key) == (2, True, 1, True)
    assert (c["B"].count, c["B"].flags) == (0, ["nonfunctional"])
    assert group.correct_percentage == 50.0


def test_ordering_distribution_is_per_position():
    options = [DetailedOptionInput(id=f"o{i}", option_text=f"langkah {i}", order=i) for i in range(3)]
    request = DetailedItemAnalysisRequest(
        exam_id="e", questions=[DetailedQuestionInput(id="q", type="ordering", options=options)],
        participants=[DetailedParticipantInput(attempt_id=f"a{i}", student_name=f"S{i}") for i in range(2)],
        answers=[DetailedAnswerInput(attempt_id="a0", question_id="q", is_correct=True, essay_answer='["o0","o1","o2"]'),
                 DetailedAnswerInput(attempt_id="a1", question_id="q", is_correct=False, essay_answer='["o1","o0","o2"]')],
    )
    groups = build_detailed_item_analysis(request).items[0].response_distribution
    assert [g.kind for g in groups] == ["position"] * 3
    first = _choices(groups[0])
    assert (first["A"].is_key, first["A"].count, first["B"].count) == (True, 1, 1)
    assert [g.correct_percentage for g in groups] == [50.0, 50.0, 100.0]


def test_short_answer_lists_the_most_common_responses():
    question = DetailedQuestionInput(id="q", type="short_answer",
                                     metadata={"blanks": [{"answer": "Jakarta", "variations": ["DKI Jakarta"]}]})
    raw = ["Jakarta", '"DKI Jakarta"', "Bandung", '["bandung"]', ""]
    request = DetailedItemAnalysisRequest(
        exam_id="e", questions=[question],
        participants=[DetailedParticipantInput(attempt_id=f"a{i}", student_name=f"S{i}") for i in range(5)],
        answers=[DetailedAnswerInput(attempt_id=f"a{i}", question_id="q", essay_answer=value) for i, value in enumerate(raw)],
    )
    group = build_detailed_item_analysis(request).items[0].response_distribution[0]
    assert group.kind == "free" and group.empty == 1
    assert [(c.value, c.is_key, c.count) for c in group.choices] == [("Jakarta", True, 1), ("DKI Jakarta", True, 1), ("Bandung", False, 2)]
    assert all(c.flags == [] for c in group.choices)
    assert group.correct_percentage == 40.0


def test_essay_has_no_distribution():
    request = DetailedItemAnalysisRequest(
        exam_id="e", questions=[DetailedQuestionInput(id="q", type="essay")],
        participants=[DetailedParticipantInput(attempt_id="a0", student_name="S")],
        answers=[DetailedAnswerInput(attempt_id="a0", question_id="q", essay_answer="uraian")],
    )
    assert build_detailed_item_analysis(request).items[0].response_distribution == []


@pytest.mark.parametrize("raw", [["X", "X"], "X", [1]])
def test_matching_analysis_rejects_malformed_pairs_like_grading(raw):
    q = DetailedQuestionInput(id="q", type="matching", options=[
        DetailedOptionInput(id="s", metadata={"match_text": "X"})])
    request = DetailedItemAnalysisRequest(exam_id="e", questions=[q],
        participants=[DetailedParticipantInput(attempt_id="a", student_name="S")],
        answers=[DetailedAnswerInput(attempt_id="a", question_id="q", is_correct=False, essay_answer={"s": raw})])
    item = build_detailed_item_analysis(request).items[0]
    assert item.wrong_students[0].answer_parts[0].correct is False
    assert item.response_distribution[0].correct_percentage == 0


@pytest.mark.parametrize("raw", ['["A","A"]', '["A","unknown"]'])
def test_complex_distribution_does_not_mark_invalid_selections_correct(raw):
    q = DetailedQuestionInput(id="q", type="mcq_complex", options=[
        DetailedOptionInput(id="A", is_correct=True), DetailedOptionInput(id="B", is_correct=False)])
    request = DetailedItemAnalysisRequest(exam_id="e", questions=[q],
        participants=[DetailedParticipantInput(attempt_id="a", student_name="S")],
        answers=[DetailedAnswerInput(attempt_id="a", question_id="q", is_correct=False, essay_answer=raw)])
    assert build_detailed_item_analysis(request).items[0].response_distribution[0].correct_percentage == 0


def test_short_answer_distribution_rejects_json_number_like_grading():
    q = DetailedQuestionInput(id="q", type="short_answer", metadata={"blanks":[{"answer":"42"}]})
    request = DetailedItemAnalysisRequest(exam_id="e", questions=[q],
        participants=[DetailedParticipantInput(attempt_id="a", student_name="S")],
        answers=[DetailedAnswerInput(attempt_id="a", question_id="q", is_correct=False, essay_answer="42")])
    group=build_detailed_item_analysis(request).items[0].response_distribution[0]
    assert group.correct_percentage == 0
    assert group.empty == 1
