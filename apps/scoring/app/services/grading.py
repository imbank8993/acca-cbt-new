"""Mesin penilaian — port dari ``apps/web/app/actions/grading.ts``.

Setiap cabang tipe soal dipertahankan persis, termasuk perlakuan khusus yang
tampak ganjil tapi ada alasannya (dicatat di komentar). Keluaran fungsi ini
menentukan nilai yang tersimpan permanen di ``cbt_answers``, jadi perbedaan
sekecil apa pun dari versi TypeScript berarti nilai siswa berubah tanpa ada
keputusan yang membuatnya berubah.
"""

from __future__ import annotations

import json
from typing import Any

from ..schemas.grading import GradingResult, Question, QuestionOption, RelativeAttempt
from .answer_parser import coerce_bool, normalize_short_answer, parse_mcq_complex_answer

ESSAY_TYPES = {"essay", "esay", "uraian"}

# Tipe psikometri: tidak menyumbang nilai akademik sama sekali, hanya mengisi
# skor dimensi. Ini yang membuat ujian campuran tidak pernah melewati 100.
PERSONALITY_TYPES = {
    "likert",
    "sjt",
    "forced_choice",
    "checklist",
    "ranking",
    "paired_comparison",
}


def _dedupe_options(options: list[QuestionOption]) -> list[QuestionOption]:
    """Buang baris opsi yang benar-benar kembar (id sama, hasil join berlapis).

    Sengaja BUKAN dedup berdasarkan teks: query penilaian tidak menyeleksi
    ``option_text`` sehingga dedup teks tidak pernah aktif, sementara sisi siswa
    dulu membuangnya — opsi berteks sama jadi tidak pernah bisa dipilih. Kedua
    sisi kini sama-sama dedup berdasarkan id.
    """
    seen: set[str] = set()
    result: list[QuestionOption] = []
    for option in options:
        if not option.id:
            result.append(option)
            continue
        if option.id in seen:
            continue
        seen.add(option.id)
        result.append(option)
    return result


def _loads(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return fallback


def calculate_single_answer_score(question: Question, raw_answer: str | None) -> GradingResult:
    default_score = question.score_default or 1
    options = _dedupe_options(question.bank_question_options or [])

    score_earned: float = 0
    is_correct: bool | None = False
    dimension_scores: dict[str, float] = {}

    qtype = (question.type or "").lower()

    if qtype in ESSAY_TYPES:
        # Esai dinilai manual: skornya 0 dan is_correct null (menunggu penilaian).
        score_earned = 0
        is_correct = None

    elif qtype == "likert":
        try:
            value = float(raw_answer) if raw_answer is not None else None
        except (TypeError, ValueError):
            value = None
        if value is not None and 1 <= value <= 5:
            score_earned = 0  # Bukan nilai akademik.
            is_correct = None
            if question.dimension_id:
                dimension_scores[question.dimension_id] = value
        # Nilai likert di luar 1–5 sengaja TIDAK menyetel is_correct: versi
        # TypeScript tidak punya cabang else, sehingga is_correct tetap pada
        # nilai awal False. Menyetelnya None di sini akan mengubah jawaban likert
        # rusak dari "salah" menjadi "menunggu penilaian manual".

    elif qtype == "mcq_complex":
        selected_ids = parse_mcq_complex_answer(raw_answer)
        correct_ids = [o.id for o in options if o.is_correct]
        is_correct = len(selected_ids) == len(correct_ids) and all(
            i in correct_ids for i in selected_ids
        )
        score_earned = default_score if is_correct else 0

    elif qtype == "checklist":
        selected_ids = _loads(raw_answer, [])
        if not isinstance(selected_ids, list):
            selected_ids = []
        is_correct = None
        score_earned = 0
        by_id = {o.id: o for o in options}
        for option_id in selected_ids:
            option = by_id.get(str(option_id))
            dimension_id = (option.metadata or {}).get("dimension_id") if option else None
            if dimension_id:
                weight = option.weight if option.weight is not None else 1
                dimension_scores[dimension_id] = dimension_scores.get(dimension_id, 0) + weight

    elif qtype == "true_false":
        answers = _loads(raw_answer, {})
        if not isinstance(answers, dict):
            answers = {}
        correct_count = sum(
            1 for o in options if coerce_bool(answers.get(o.id)) == o.is_correct
        )
        ratio = correct_count / len(options) if options else 0
        score_earned = ratio * default_score
        is_correct = ratio == 1

    elif qtype == "categorization":
        student = _loads(raw_answer, {})
        if not isinstance(student, dict):
            student = {}
        correct_count = 0
        for option in options:
            selected = student.get(option.id) or []
            metadata = option.metadata or {}
            correct_cats = metadata.get("category_names")
            if not correct_cats:
                single = metadata.get("category_name")
                correct_cats = [single] if single else []
            if len(selected) == len(correct_cats) and all(c in correct_cats for c in selected):
                correct_count += 1
        ratio = correct_count / len(options) if options else 0
        score_earned = ratio * default_score
        is_correct = ratio == 1

    elif qtype == "matching":
        pairs = _loads(raw_answer, {})
        if not isinstance(pairs, dict):
            pairs = {}
        correct_count = 0
        for option in options:
            matches = pairs.get(option.id) or []
            metadata = option.metadata or {}
            correct_matches = metadata.get("match_texts")
            if not correct_matches:
                single = metadata.get("match_text")
                correct_matches = [single] if single else []
            if len(matches) == len(correct_matches) and all(
                m in correct_matches for m in matches
            ):
                correct_count += 1
        ratio = correct_count / len(options) if options else 0
        score_earned = ratio * default_score
        is_correct = ratio == 1

    elif qtype == "short_answer":
        inputs = _loads(raw_answer, None)
        if inputs is None:
            inputs = [raw_answer] if raw_answer else []
        elif isinstance(inputs, str):
            inputs = [inputs]
        elif not isinstance(inputs, list):
            inputs = []

        blanks = (question.metadata or {}).get("blanks") or []
        correct_blanks: float = 0

        for index, blank in enumerate(blanks):
            student_input = normalize_short_answer(
                inputs[index] if index < len(inputs) else None
            )
            variations = [normalize_short_answer(v) for v in (blank.get("variations") or [])]
            answer = normalize_short_answer(blank.get("answer"))

            if student_input == answer or student_input in variations:
                correct_blanks += 1
            elif len(student_input) > 0:
                # Isian kosong tidak boleh dapat kredit parsial (``"" in answer``
                # selalu benar), jadi cabang ini hanya jalan bila siswa mengisi.
                matched = bool(answer) and (
                    answer in student_input or student_input in answer
                )
                if not matched:
                    matched = any(
                        v and (v in student_input or student_input in v) for v in variations
                    )
                if matched:
                    correct_blanks += 0.5

        ratio = correct_blanks / len(blanks) if blanks else 0
        score_earned = ratio * default_score
        is_correct = ratio == 1

    elif qtype == "sjt":
        # Murni psikometri: SJT TIDAK menyumbang nilai akademik (0–100). Ia
        # dikecualikan dari max_possible_score, sehingga memberinya skor bukan-nol
        # dulu membuat ujian campuran melebihi 100.
        selected_id = raw_answer.strip() if isinstance(raw_answer, str) else None
        selected = next((o for o in options if o.id == selected_id), None)
        weight = (selected.weight if selected and selected.weight is not None else 0)

        is_correct = None
        score_earned = 0
        if question.dimension_id and weight > 0:
            dimension_scores[question.dimension_id] = weight

    elif qtype in ("forced_choice", "paired_comparison"):
        selected_id = raw_answer.strip() if isinstance(raw_answer, str) else None
        selected = next((o for o in options if o.id == selected_id), None)

        is_correct = None
        score_earned = 0
        dimension_id = (selected.metadata or {}).get("dimension_id") if selected else None
        if dimension_id:
            dimension_scores[dimension_id] = (
                selected.weight if selected.weight is not None else 1
            )

    elif qtype in ("ordering", "ranking"):
        order = _loads(raw_answer, None)
        if order is None:
            order = [raw_answer] if isinstance(raw_answer, str) and raw_answer else []
        elif not isinstance(order, list):
            order = []
        order = [str(o) for o in order]

        if qtype == "ranking":
            is_correct = None
            score_earned = 0
            max_rank = len(options)
            by_id = {o.id: o for o in options}
            for index, option_id in enumerate(order):
                option = by_id.get(option_id)
                dimension_id = (option.metadata or {}).get("dimension_id") if option else None
                if dimension_id:
                    # Peringkat pertama mendapat max_rank poin, terakhir 1 poin.
                    rank_score = max_rank - index
                    dimension_scores[dimension_id] = (
                        dimension_scores.get(dimension_id, 0) + rank_score
                    )
        else:
            correct_order = (question.metadata or {}).get("correct_order") or []
            if not correct_order:
                correct_order = [
                    o.id for o in sorted(options, key=lambda o: o.order if o.order is not None else 0)
                ]

            correct_positions = sum(
                1
                for i, option_id in enumerate(correct_order)
                if i < len(order) and order[i] == option_id
            )
            total = len(correct_order)
            ratio = correct_positions / total if total else 0
            score_earned = ratio * default_score
            is_correct = correct_positions == total and total > 0

    else:
        # Pilihan ganda biasa.
        #
        # Versi TypeScript menulis `rawAnswer && correctOption && rawAnswer === id`.
        # Operator && di JavaScript mengembalikan operan yang falsy, bukan false —
        # jadi jawaban kosong menghasilkan is_correct = "" dan jawaban null
        # menghasilkan null, padahal tipenya dideklarasikan `boolean | null`.
        # Nilai-nilai itu dinormalkan menjadi NULL oleh pemanggilnya, jadi None di
        # sini adalah padanan yang setia. Mengembalikan False akan membuat soal
        # tak terjawab terhitung sebagai jawaban SALAH di analisis butir.
        correct_option = next((o for o in options if o.is_correct), None)
        if not raw_answer or correct_option is None:
            is_correct = None
            score_earned = 0
        else:
            is_correct = raw_answer == correct_option.id
            score_earned = default_score if is_correct else 0

    return GradingResult(
        score=score_earned,
        is_correct=is_correct,
        dimension_scores=dimension_scores,
    )


def is_academic_type(qtype: str) -> bool:
    """Apakah tipe soal ini ikut menentukan nilai akademik 0–100."""
    return (qtype or "").lower() not in PERSONALITY_TYPES


def scale_to_hundred(total: float, max_possible: float) -> float:
    """Skalakan total mentah ke 0–100.

    Sengaja TIDAK dibulatkan, mengikuti ``gradeAttemptFromSavedAnswers`` yang
    mengembalikan hasil bagi apa adanya. Pembulatan di sini akan menggeser nilai
    tersimpan milik attempt yang dinilai ulang.
    """
    if max_possible <= 0:
        return 0.0
    return (total / max_possible) * 100


def apply_relative_scoring(attempts: list[RelativeAttempt]) -> dict[str, float]:
    """Penalti kecepatan untuk kuis berskor relatif.

    Bukan kurva: peserta dikelompokkan menurut ``base_score`` yang sama, lalu di
    dalam tiap kelompok diurutkan dari yang tercepat. Peringkat ke-i dikurangi
    0,01 poin, sehingga dua peserta dengan jumlah benar yang sama dibedakan oleh
    kecepatan tanpa mengubah peringkat antar kelompok — selisih maksimum dalam
    satu kelompok jauh lebih kecil dari satu poin.
    """
    result: dict[str, float] = {}

    groups: dict[float, list[RelativeAttempt]] = {}
    for attempt in attempts:
        groups.setdefault(attempt.base_score, []).append(attempt)

    for group in groups.values():
        group.sort(key=lambda a: a.duration_seconds)  # tercepat lebih dulu
        for index, attempt in enumerate(group):
            penalty = index * 0.01
            result[attempt.attempt_id] = max(0.0, round(attempt.base_score - penalty, 2))

    return result
