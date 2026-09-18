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

from ..schemas.analytics import (
    ExamAnalyticsRequest,
    ExamAnalyticsResponse,
    ItemAnalysisRequest,
    ItemAnalysisResponse,
    ItemStatistic,
    QuestionAnalytics,
    ScoreDistributionBucket,
    ScoreStats,
)

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
