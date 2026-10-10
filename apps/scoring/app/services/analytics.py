"""Analitik ujian dan statistik butir.

``build_exam_analytics`` adalah port dari ``getExamAnalytics``
(``apps/web/app/actions/analytics.ts``) dan sengaja mempertahankan beberapa
kejanggalan perhitungannya agar angka yang tampil di dasbor tidak berubah —
lihat komentar masing-masing.

``analyze_items`` adalah tambahan baru: indeks kesukaran dan daya beda klasik
yang sebelumnya tidak pernah dihitung (kolom ``difficulty`` hanya berisi label
yang diisi manual pembuat soal).
"""

from __future__ import annotations

import json
import re

from ..schemas.analytics import (
    DetailedAnswerInput,
    DetailedItemAnalysisRequest,
    DetailedItemAnalysisResponse,
    DetailedItemResult,
    DetailedOptionInput,
    DetailedParticipantInput,
    DetailedQuestionInput,
    DistractorOptionStat,
    ExamAnalyticsRequest,
    ExamAnalyticsResponse,
    ItemAnalysisRequest,
    ItemAnalysisResponse,
    ItemStatistic,
    QuestionAnalytics,
    ScoreDistributionBucket,
    ScoreStats,
    StudentAnswerSummary,
    StudentItemCell,
    StudentItemMatrixRow,
)
from .answer_parser import parse_mcq_complex_answer

DISTRIBUTION_BUCKETS = [
    ("0-20", 0, 20),
    ("21-40", 21, 40),
    ("41-60", 41, 60),
    ("61-80", 61, 80),
    ("81-100", 81, 100),
]


def build_exam_analytics(request: ExamAnalyticsRequest) -> ExamAnalyticsResponse:
    finished = set(request.finished_statuses)
    completed = [a for a in request.attempts if a.status in finished]

    # Skor 0 yang sah ikut dihitung; hanya attempt yang belum ternilai
    # (total_score null, mis. esai menunggu koreksi) yang dikecualikan.
    scores = [float(a.total_score or 0) for a in completed if a.total_score is not None]
    ordered = sorted(scores)

    score_stats = ScoreStats(
        # Dibulatkan ke bilangan bulat, sama seperti Math.round di versi lama.
        average=round(sum(scores) / len(scores)) if scores else 0,
        # Median naif: elemen ke-floor(n/2). Untuk n genap ini mengambil nilai
        # tengah ATAS, bukan rata-rata dua nilai tengah. Dipertahankan apa adanya
        # agar angka di dasbor tidak bergeser tanpa keputusan.
        median=ordered[len(ordered) // 2] if ordered else 0,
        highest=ordered[-1] if ordered else 0,
        lowest=ordered[0] if ordered else 0,
        total=sum(scores),
        completed=len(scores),
    )

    distribution = [
        ScoreDistributionBucket(
            range=label,
            count=(count := sum(1 for s in scores if low <= s <= high)),
            percentage=round((count / len(scores)) * 100) if scores else 0,
        )
        for label, low, high in DISTRIBUTION_BUCKETS
    ]

    by_question: dict[str, list] = {}
    for answer in request.answers:
        by_question.setdefault(answer.question_id, []).append(answer)

    question_analytics: list[QuestionAnalytics] = []
    for question in request.questions:
        answers = by_question.get(question.id, [])
        correct = sum(1 for a in answers if a.is_correct is True)
        wrong = sum(1 for a in answers if a.is_correct is False)
        total = len(answers)

        question_analytics.append(
            QuestionAnalytics(
                question_id=question.id,
                question_text=question.question_text,
                question_type=question.type,
                total_attempts=total,
                correct_count=correct,
                wrong_count=wrong,
                unanswered_count=max(0, len(completed) - total),
                correct_percentage=round((correct / total) * 100) if total else 0,
                difficulty=question.difficulty or "medium",
            )
        )

    # Tersulit lebih dulu.
    question_analytics.sort(key=lambda q: q.correct_percentage)

    return ExamAnalyticsResponse(
        exam_id=request.exam_id,
        exam_title=request.exam_title,
        total_participants=len(request.attempts),
        completed_count=len(completed),
        in_progress_count=sum(1 for a in request.attempts if a.status == "in_progress"),
        score_stats=score_stats,
        question_analytics=question_analytics,
        score_distribution=distribution,
    )


def _difficulty_label(index: float) -> str:
    # Kategori baku Indonesia untuk indeks kesukaran (P).
    if index >= 0.71:
        return "mudah"
    if index >= 0.31:
        return "sedang"
    return "sukar"


def _discrimination_label(index: float) -> str:
    # Kategori Ebel untuk daya beda (D).
    if index >= 0.40:
        return "sangat baik"
    if index >= 0.30:
        return "baik"
    if index >= 0.20:
        return "cukup"
    if index >= 0.0:
        return "jelek"
    return "dibuang"


def analyze_items(request: ItemAnalysisRequest) -> ItemAnalysisResponse:
    """Indeks kesukaran dan daya beda klasik per butir.

    Daya beda memakai metode kelompok atas–bawah: peserta diurutkan menurut skor
    total, lalu D = P(atas) − P(bawah).
    """
    # Skor total per peserta, dipakai membentuk kelompok atas dan bawah.
    totals: dict[str, float] = {}
    for answer in request.answers:
        totals[answer.attempt_id] = totals.get(answer.attempt_id, 0) + (
            answer.score if answer.score is not None else (1 if answer.is_correct else 0)
        )

    ranked = sorted(totals, key=lambda a: totals[a], reverse=True)
    respondents = len(ranked)

    fraction = min(max(request.group_fraction, 0.05), 0.5)
    group_size = max(1, int(respondents * fraction)) if respondents else 0
    upper = set(ranked[:group_size])
    lower = set(ranked[-group_size:]) if group_size else set()

    # Dengan peserta sangat sedikit, kelompok atas dan bawah bisa beririsan dan
    # daya beda menjadi tak bermakna. Irisannya dibuang agar hasilnya jujur
    # (mendekati 0) alih-alih terlihat tinggi secara palsu.
    if upper & lower:
        overlap = upper & lower
        upper -= overlap
        lower -= overlap

    by_question: dict[str, list] = {}
    for answer in request.answers:
        by_question.setdefault(answer.question_id, []).append(answer)

    items: list[ItemStatistic] = []
    for question in request.questions:
        answers = by_question.get(question.id, [])
        total = len(answers)
        correct = sum(1 for a in answers if a.is_correct is True)

        difficulty = correct / total if total else 0.0

        upper_answers = [a for a in answers if a.attempt_id in upper]
        lower_answers = [a for a in answers if a.attempt_id in lower]
        p_upper = (
            sum(1 for a in upper_answers if a.is_correct is True) / len(upper_answers)
            if upper_answers
            else 0.0
        )
        p_lower = (
            sum(1 for a in lower_answers if a.is_correct is True) / len(lower_answers)
            if lower_answers
            else 0.0
        )
        discrimination = p_upper - p_lower

        items.append(
            ItemStatistic(
                question_id=question.id,
                respondents=total,
                difficulty_index=round(difficulty, 4),
                difficulty_label=_difficulty_label(difficulty),
                discrimination_index=round(discrimination, 4),
                discrimination_label=_discrimination_label(discrimination),
            )
        )

    return ItemAnalysisResponse(items=items, respondents=respondents)


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    return (
        clean.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .strip()
    )


def _format_student_answer(
    q_type: str,
    raw_val: Any,
    option_letters: dict[str, str],
    option_texts: dict[str, str],
) -> str:
    if raw_val is None or raw_val == "":
        return "-"

    q_type = q_type.lower()
    if q_type == "mcq":
        opt_id = str(raw_val)
        letter = option_letters.get(opt_id)
        if letter:
            text = _strip_html(option_texts.get(opt_id, ""))[:50]
            return f"{letter}. {text}" if text else letter
        return str(raw_val)

    if q_type in ("mcq_complex", "checklist", "ranking", "ordering"):
        opts = parse_mcq_complex_answer(raw_val)
        letters = [option_letters.get(o, o) for o in opts]
        return ", ".join(letters) if letters else "-"

    if q_type in ("true_false", "matching", "categorization"):
        if isinstance(raw_val, dict):
            parts = [f"{k}: {v}" for k, v in raw_val.items()]
            return "; ".join(parts)[:120]
        if isinstance(raw_val, str):
            try:
                parsed = json.loads(raw_val)
                if isinstance(parsed, dict):
                    return "; ".join(f"{k}: {v}" for k, v in parsed.items())[:120]
            except Exception:
                pass
            return str(raw_val)[:120]

    return str(raw_val).strip()


def _build_key_display(
    q: DetailedQuestionInput,
    option_letters: dict[str, str],
    option_texts: dict[str, str],
) -> str:
    q_type = (q.type or "mcq").lower()
    if q_type == "mcq":
        correct_opts = [o for o in q.options if o.is_correct]
        if correct_opts:
            c = correct_opts[0]
            letter = option_letters.get(c.id, "")
            text = _strip_html(option_texts.get(c.id, ""))[:50]
            return f"{letter}. {text}" if text else letter
        return "-"

    if q_type in ("mcq_complex", "checklist"):
        correct_opts = [o for o in q.options if o.is_correct]
        letters = [option_letters.get(o.id, "") for o in correct_opts]
        return ", ".join([l for l in letters if l]) or "-"

    if q_type in ("essay", "esay", "uraian"):
        return "Rubrik / Koreksi Manual"

    if q_type == "short_answer":
        correct_texts = [_strip_html(o.option_text or "") for o in q.options if o.option_text]
        return " / ".join(correct_texts) if correct_texts else "-"

    correct_letters = [option_letters.get(o.id, "") for o in q.options if o.is_correct]
    return ", ".join([l for l in correct_letters if l]) or "-"


def build_detailed_item_analysis(request: DetailedItemAnalysisRequest) -> DetailedItemAnalysisResponse:
    participant_by_attempt: dict[str, DetailedParticipantInput] = {
        p.attempt_id: p for p in request.participants
    }

    totals: dict[str, float] = {}
    for p in request.participants:
        totals[p.attempt_id] = float(p.total_score or 0)

    for ans in request.answers:
        if ans.attempt_id not in totals or totals[ans.attempt_id] == 0:
            totals[ans.attempt_id] = totals.get(ans.attempt_id, 0) + (
                ans.score if ans.score is not None else (1.0 if ans.is_correct else 0.0)
            )

    ranked = sorted(totals.keys(), key=lambda a: totals.get(a, 0), reverse=True)
    respondents = len(ranked)

    fraction = min(max(request.group_fraction, 0.05), 0.5)
    group_size = max(1, int(respondents * fraction)) if respondents else 0
    upper = set(ranked[:group_size])
    lower = set(ranked[-group_size:]) if group_size else set()

    if upper & lower:
        overlap = upper & lower
        upper -= overlap
        lower -= overlap

    answers_by_key: dict[tuple[str, str], DetailedAnswerInput] = {}
    by_question: dict[str, list[DetailedAnswerInput]] = {}
    for a in request.answers:
        answers_by_key[(a.attempt_id, a.question_id)] = a
        by_question.setdefault(a.question_id, []).append(a)

    items: list[DetailedItemResult] = []

    for q in request.questions:
        q_options = sorted(q.options, key=lambda o: o.order or 0)
        option_letters: dict[str, str] = {}
        option_texts: dict[str, str] = {}
        for idx, opt in enumerate(q_options):
            letter = chr(65 + idx) if idx < 26 else f"Opt{idx+1}"
            option_letters[opt.id] = letter
            option_texts[opt.id] = opt.option_text or ""

        key_display = _build_key_display(q, option_letters, option_texts)
        q_answers = by_question.get(q.id, [])
        answered_attempt_ids = set()

        correct_students: list[StudentAnswerSummary] = []
        wrong_students: list[StudentAnswerSummary] = []
        ungraded_students: list[StudentAnswerSummary] = []
        unanswered_students: list[StudentAnswerSummary] = []

        option_counts: dict[str, list[str]] = {opt.id: [] for opt in q_options}

        for ans in q_answers:
            p = participant_by_attempt.get(ans.attempt_id)
            p_name = p.student_name if p else "Tanpa Nama"
            p_class = p.class_name if p else "-"
            p_nis = p.student_nis if p else "-"

            answered_attempt_ids.add(ans.attempt_id)
            raw_val = (
                ans.essay_answer
                if (ans.essay_answer is not None and ans.essay_answer != "")
                else ans.selected_option_id
            )
            disp_ans = _format_student_answer(q.type or "mcq", raw_val, option_letters, option_texts)

            if (q.type or "mcq").lower() == "mcq" and ans.selected_option_id:
                if ans.selected_option_id in option_counts:
                    option_counts[ans.selected_option_id].append(p_name)

            summary = StudentAnswerSummary(
                attempt_id=ans.attempt_id,
                student_name=p_name,
                class_name=p_class,
                student_nis=p_nis,
                score=float(ans.score or 0.0)
                if ans.score is not None
                else (float(q.score_default if q.score_default is not None else 1.0) if ans.is_correct else 0.0),
                display_answer=disp_ans,
                is_correct=ans.is_correct,
            )

            if ans.is_correct is True:
                correct_students.append(summary)
            elif ans.is_correct is False:
                wrong_students.append(summary)
            else:
                ungraded_students.append(summary)

        for p in request.participants:
            if p.attempt_id not in answered_attempt_ids:
                unanswered_students.append(
                    StudentAnswerSummary(
                        attempt_id=p.attempt_id,
                        student_name=p.student_name,
                        class_name=p.class_name or "-",
                        student_nis=p.student_nis or "-",
                        score=0.0,
                        display_answer="-",
                        is_correct=False,
                    )
                )

        correct_students.sort(key=lambda s: s.student_name.lower())
        wrong_students.sort(key=lambda s: s.student_name.lower())
        ungraded_students.sort(key=lambda s: s.student_name.lower())
        unanswered_students.sort(key=lambda s: s.student_name.lower())

        total_ans = len(q_answers)
        tot_correct = len(correct_students)
        tot_incorrect = len(wrong_students)
        tot_ungraded = len(ungraded_students)
        tot_unanswered = len(unanswered_students)
        graded_total = tot_correct + tot_incorrect

        incorrect_pct = (tot_incorrect / graded_total * 100) if graded_total > 0 else 0.0
        difficulty = tot_correct / total_ans if total_ans > 0 else 0.0

        upper_answers = [a for a in q_answers if a.attempt_id in upper]
        lower_answers = [a for a in q_answers if a.attempt_id in lower]
        p_upper = (
            sum(1 for a in upper_answers if a.is_correct is True) / len(upper_answers)
            if upper_answers
            else 0.0
        )
        p_lower = (
            sum(1 for a in lower_answers if a.is_correct is True) / len(lower_answers)
            if lower_answers
            else 0.0
        )
        discrimination = p_upper - p_lower

        distractor_stats: list[DistractorOptionStat] = []
        for opt in q_options:
            c = len(option_counts.get(opt.id, []))
            pct = (c / total_ans * 100) if total_ans > 0 else 0.0
            distractor_stats.append(
                DistractorOptionStat(
                    option_id=opt.id,
                    option_letter=option_letters.get(opt.id, "-"),
                    option_text=_strip_html(opt.option_text or ""),
                    is_correct=opt.is_correct,
                    count=c,
                    percentage=round(pct, 1),
                    student_names=sorted(option_counts.get(opt.id, [])),
                )
            )

        items.append(
            DetailedItemResult(
                id=q.id,
                number=q.number or 0,
                question_text=q.question_text or "",
                type=q.type or "mcq",
                score_default=float(q.score_default if q.score_default is not None else 1.0),
                key_display=key_display,
                options=q_options,
                total_participants=len(request.participants),
                total_answered=total_ans,
                total_correct=tot_correct,
                total_incorrect=tot_incorrect,
                total_ungraded=tot_ungraded,
                total_unanswered=tot_unanswered,
                incorrect_percentage=round(incorrect_pct, 1),
                difficulty_index=round(difficulty, 4),
                difficulty_label=_difficulty_label(difficulty),
                discrimination_index=round(discrimination, 4),
                discrimination_label=_discrimination_label(discrimination),
                correct_students=correct_students,
                wrong_students=wrong_students,
                ungraded_students=ungraded_students,
                unanswered_students=unanswered_students,
                distractor_distribution=distractor_stats,
            )
        )

    matrix: list[StudentItemMatrixRow] = []

    for p in request.participants:
        p_row_items: dict[str, StudentItemCell] = {}
        tot_c = 0
        tot_w = 0
        tot_u = 0

        for q in request.questions:
            ans = answers_by_key.get((p.attempt_id, q.id))
            if ans is None:
                tot_u += 1
                p_row_items[q.id] = StudentItemCell(
                    score=0.0,
                    is_correct=False,
                    display_answer="-",
                    status="unanswered",
                )
            else:
                q_options = sorted(q.options, key=lambda o: o.order or 0)
                opt_letters = {opt.id: chr(65 + i) for i, opt in enumerate(q_options)}
                opt_texts = {opt.id: opt.option_text or "" for opt in q_options}
                raw_val = (
                    ans.essay_answer
                    if (ans.essay_answer is not None and ans.essay_answer != "")
                    else ans.selected_option_id
                )
                disp_ans = _format_student_answer(q.type or "mcq", raw_val, opt_letters, opt_texts)

                if ans.is_correct is True:
                    tot_c += 1
                    status = "correct"
                elif ans.is_correct is False:
                    tot_w += 1
                    status = "wrong"
                else:
                    status = "ungraded"

                p_row_items[q.id] = StudentItemCell(
                    score=float(ans.score or 0.0)
                    if ans.score is not None
                    else (float(q.score_default if q.score_default is not None else 1.0) if ans.is_correct else 0.0),
                    is_correct=ans.is_correct,
                    display_answer=disp_ans,
                    status=status,
                )

        matrix.append(
            StudentItemMatrixRow(
                attempt_id=p.attempt_id,
                student_name=p.student_name,
                student_nis=p.student_nis or "-",
                class_name=p.class_name or "-",
                status=p.status or "submitted",
                total_score=float(p.total_score or 0.0),
                total_correct=tot_c,
                total_wrong=tot_w,
                total_unanswered=tot_u,
                items=p_row_items,
            )
        )

    matrix.sort(key=lambda r: r.student_name.lower())

    return DetailedItemAnalysisResponse(
        exam_id=request.exam_id,
        total_questions=len(request.questions),
        total_participants=len(request.participants),
        items=items,
        matrix=matrix,
    )
