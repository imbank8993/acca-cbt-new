"""Item Response Theory (1PL/2PL/3PL) — port dari ``apps/web/app/actions/irt.ts``.

Algoritmanya dipertahankan persis: tebakan awal theta dari log-odds skor mentah,
tiga iterasi Newton-Raphson dengan lompatan dibatasi ±1, theta akhir dijepit ke
[-4, 4], lalu dipetakan ke skala 0–100 (rerata 50, simpangan 15).

Beda dengan versi TypeScript hanyalah perulangan butir yang divektorkan dengan
NumPy. Untuk ujian sekelas (ratusan peserta × ratusan butir) itu tiga perkalian
matriks, bukan tiga perulangan bersarang.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

import numpy as np

from ..schemas.irt import AttemptScore, IrtAttempt, IrtRequest, IrtResponse, ItemParameter

# Skala UTBK.
SCALE_MEAN = 50.0
SCALE_STD = 15.0

# Konstanta penskalaan logistik IRT.
D_CONSTANT = 1.7

PERSONALITY_TYPES = {
    "likert",
    "sjt",
    "forced_choice",
    "checklist",
    "ranking",
    "paired_comparison",
}
ESSAY_TYPES = {"essay", "esay", "uraian"}
# Tipe yang satu soalnya dipecah menjadi beberapa butir IRT, satu per opsi.
UNFOLDED_TYPES = {"true_false", "matching", "categorization"}


class IrtError(ValueError):
    """Kondisi yang membuat hasil IRT menyesatkan bila tetap dihitung."""


@dataclass
class ItemStat:
    total: int = 0
    correct: int = 0
    p_value: float = 0.5
    b: float = 0.0
    a: float = 1.0
    c: float = 0.2


@dataclass
class StudentData:
    attempt_id: str
    correct_item_ids: set[str] = field(default_factory=set)
    total_answered: int = 0
    essay_score_achieved: float = 0.0
    total_essay_weight: float = 0.0
    objective_raw_score: float = 0.0
    # Bobot objektif dalam POIN (Σ score_default), supaya penggabungan dengan
    # esai memakai satuan yang sama — bukan sekadar jumlah butir.
    objective_weight: float = 0.0


def _loads(raw: str | None) -> dict:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def _is_sub_item_correct(qtype: str, option, parsed: dict) -> bool:
    if qtype == "true_false":
        return parsed.get(option.id) == option.is_correct

    metadata = option.metadata or {}
    if qtype == "matching":
        student = parsed.get(option.id) or []
        correct = metadata.get("match_texts")
        if not correct:
            single = metadata.get("match_text")
            correct = [single] if single else []
    elif qtype == "categorization":
        student = parsed.get(option.id) or []
        correct = metadata.get("category_names")
        if not correct:
            single = metadata.get("category_name")
            correct = [single] if single else []
    else:
        return False

    return len(student) == len(correct) and all(s in correct for s in student)


def _collect(attempts: list[IrtAttempt]) -> tuple[dict[str, ItemStat], dict[str, StudentData]]:
    item_stats: dict[str, ItemStat] = {}
    students: dict[str, StudentData] = {}

    for attempt in attempts:
        student = StudentData(attempt_id=attempt.id)

        for answer in attempt.answers:
            question = answer.bank_questions
            if question is None:
                continue

            qtype = (question.type or "mcq").lower()
            weight = question.score_default or 1

            if qtype in PERSONALITY_TYPES:
                # Diabaikan sepenuhnya: tipe psikometri tidak mengukur kemampuan.
                continue

            if qtype in ESSAY_TYPES:
                student.essay_score_achieved += answer.score or 0
                student.total_essay_weight += weight
                continue

            if qtype in UNFOLDED_TYPES:
                student.objective_weight += weight
                # Tipe kompleks menyimpan JSON di essay_answer — tidak ada kolom
                # raw_answer di cbt_answers.
                parsed = _loads(answer.essay_answer)

                for option in question.bank_question_options:
                    item_id = f"{answer.question_id}_{option.id}"
                    student.total_answered += 1

                    stat = item_stats.setdefault(item_id, ItemStat())
                    stat.total += 1

                    if _is_sub_item_correct(qtype, option, parsed):
                        stat.correct += 1
                        student.correct_item_ids.add(item_id)
                        student.objective_raw_score += 1
                continue

            # Standar: MCQ, isian singkat, MCQ kompleks.
            item_id = answer.question_id
            student.total_answered += 1
            student.objective_weight += weight

            if item_id not in item_stats:
                # Tebakan semu (c) mengikuti jumlah opsi; default 0,2.
                options = question.bank_question_options
                c_value = 1 / len(options) if options else 0.2
                item_stats[item_id] = ItemStat(c=c_value)

            stat = item_stats[item_id]
            stat.total += 1
            if answer.is_correct:
                stat.correct += 1
                student.correct_item_ids.add(item_id)
                student.objective_raw_score += 1

        students[attempt.id] = student

    return item_stats, students


def _estimate_item_parameters(
    item_stats: dict[str, ItemStat],
    students: dict[str, StudentData],
    need_discrimination: bool,
) -> None:
    count = len(students)
    if count == 0:
        return

    raw = np.array([s.objective_raw_score for s in students.values()], dtype=float)
    mean_raw = float(raw.mean())
    # Simpangan baku sampel (pembagi n-1). Nol diganti 1 agar point-biserial
    # tidak membagi nol saat seluruh peserta memperoleh skor mentah yang sama.
    std_raw = float(raw.std(ddof=1)) if count > 1 else 0.0
    if not std_raw:
        std_raw = 1.0

    for item_id, stat in item_stats.items():
        p = stat.correct / stat.total if stat.total else 0.5
        p = min(max(p, 0.01), 0.99)
        stat.p_value = p
        stat.b = math.log((1 - p) / p)  # Tingkat kesulitan Rasch.

        if not need_discrimination:
            continue

        total_correct_raw = sum(
            s.objective_raw_score for s in students.values() if item_id in s.correct_item_ids
        )
        mean_correct = total_correct_raw / stat.correct if stat.correct > 0 else 0.0

        rpb = ((mean_correct - mean_raw) / std_raw) * math.sqrt(p / (1 - p))

        denominator = 1 - rpb * rpb
        a = rpb / math.sqrt(denominator) if denominator > 0 else 1.0
        if math.isnan(a):
            a = 1.0
        stat.a = min(max(a, 0.1), 3.0)


def _theta_score(
    student: StudentData,
    model: str,
    item_ids: list[str],
    a_all: np.ndarray,
    b_all: np.ndarray,
    c_all: np.ndarray,
) -> float:
    a = a_all if model in ("2pl", "3pl") else np.ones_like(a_all)
    c = c_all if model == "3pl" else np.zeros_like(c_all)
    u = np.array([1.0 if i in student.correct_item_ids else 0.0 for i in item_ids])

    # Tebakan awal theta dari log-odds proporsi benar.
    p_score = len(student.correct_item_ids) / student.total_answered
    p_score = min(max(p_score, 0.01), 0.99)
    theta = math.log(p_score / (1 - p_score))

    for _ in range(3):
        logit = np.exp(D_CONSTANT * a * (theta - b_all))
        p_star = logit / (1 + logit)
        q_star = 1 - p_star
        p = c + (1 - c) * p_star
        q = 1 - p

        valid = (p > 0) & (q > 0)
        first = float(np.sum((a * (u - p) * (p_star / p))[valid]))
        second = float(-np.sum((a * a * p_star * q_star * (u * c / (p * p) + 1))[valid]))

        if abs(second) > 0.001:
            delta = first / second
            # Lompatan dibatasi ±1 agar iterasi tidak melempar theta ke ekstrem
            # saat turunan keduanya sangat kecil.
            theta -= min(max(delta, -1.0), 1.0)

    theta = min(max(theta, -4.0), 4.0)

    objective_scaled = min(max(SCALE_MEAN + theta * SCALE_STD, 0.0), 100.0)

    essay_scaled = 0.0
    if student.total_essay_weight > 0:
        essay_scaled = (student.essay_score_achieved / student.total_essay_weight) * 100

    total_weight = student.objective_weight + student.total_essay_weight
    if total_weight <= 0:
        return 0.0

    final = (student.objective_weight / total_weight) * objective_scaled + (
        student.total_essay_weight / total_weight
    ) * essay_scaled
    return round(final, 2)


def calculate_exam_irt(request: IrtRequest) -> IrtResponse:
    scoring_types = {t.strip().lower() for t in request.scoring_types}
    calc_1pl = "irt_1pl" in scoring_types or "irt" in scoring_types
    calc_2pl = "irt_2pl" in scoring_types
    calc_3pl = "irt_3pl" in scoring_types

    if not (calc_1pl or calc_2pl or calc_3pl):
        raise IrtError("Tidak ada sistem penilaian IRT yang dipilih.")
    if not request.attempts:
        raise IrtError("Belum ada peserta yang menyelesaikan ujian.")

    # IRT hanya mengestimasi kemampuan dari butir objektif; skor esai digabung
    # dari penilaian manual. Bila masih ada esai yang belum dinilai, skornya 0
    # dan akan MENYERET hasil turun secara diam-diam.
    ungraded = sum(1 for a in request.attempts if a.needs_manual_grading)
    if ungraded > 0:
        raise IrtError(
            f"Masih ada {ungraded} peserta dengan esai/tugas yang belum dinilai. "
            "Selesaikan penilaian esai terlebih dahulu agar skor IRT akurat, lalu hitung ulang."
        )

    item_stats, students = _collect(request.attempts)
    _estimate_item_parameters(item_stats, students, need_discrimination=calc_2pl or calc_3pl)

    item_ids = list(item_stats.keys())
    a_all = np.array([item_stats[i].a for i in item_ids], dtype=float)
    b_all = np.array([item_stats[i].b for i in item_ids], dtype=float)
    c_all = np.array([item_stats[i].c for i in item_ids], dtype=float)

    results: list[AttemptScore] = []

    for attempt in request.attempts:
        student = students[attempt.id]

        if student.total_answered == 0:
            # Tidak menjawab satu pun butir objektif: seluruh nilai berasal dari esai.
            essay_scaled = 0.0
            if student.total_essay_weight > 0:
                essay_scaled = (student.essay_score_achieved / student.total_essay_weight) * 100

            detailed = {"classical": essay_scaled}
            if calc_1pl:
                detailed["irt_1pl"] = essay_scaled
            if calc_2pl:
                detailed["irt_2pl"] = essay_scaled
            if calc_3pl:
                detailed["irt_3pl"] = essay_scaled

            results.append(
                AttemptScore(id=attempt.id, detailed_scores=detailed, score_irt=essay_scaled)
            )
            continue

        denominator = student.total_answered + student.total_essay_weight
        classical = (
            (student.objective_raw_score + student.essay_score_achieved) / denominator * 100
            if denominator
            else 0.0
        )
        detailed = {"classical": round(classical, 2)}

        if calc_1pl:
            detailed["irt_1pl"] = _theta_score(student, "1pl", item_ids, a_all, b_all, c_all)
        if calc_2pl:
            detailed["irt_2pl"] = _theta_score(student, "2pl", item_ids, a_all, b_all, c_all)
        if calc_3pl:
            detailed["irt_3pl"] = _theta_score(student, "3pl", item_ids, a_all, b_all, c_all)

        score_irt = (
            detailed.get("irt_3pl")
            or detailed.get("irt_2pl")
            or detailed.get("irt_1pl")
            or detailed["classical"]
        )
        results.append(
            AttemptScore(id=attempt.id, detailed_scores=detailed, score_irt=score_irt)
        )

    items = [
        ItemParameter(
            item_id=item_id,
            total=stat.total,
            correct=stat.correct,
            p_value=round(stat.p_value, 4),
            b=round(stat.b, 4),
            a=round(stat.a, 4),
            c=round(stat.c, 4),
        )
        for item_id, stat in item_stats.items()
    ]

    return IrtResponse(count=len(results), attempts=results, items=items)
