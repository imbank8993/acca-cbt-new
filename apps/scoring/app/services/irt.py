"""Item Response Theory (1PL/2PL/3PL) — port dari ``apps/web/app/actions/irt.ts``.

Skor IRT dikembalikan sebagai estimasi kemampuan theta; tampilan mengubahnya ke
skala 200–800 (500 + 100θ). Nilai klasikal tetap dalam skala 0–100.

Setiap model memakai satu metrik yang konsisten untuk parameter butir dan θ:

* 1PL (Rasch): metrik logistik D = 1, b = ln((1 − p) / p).
* 2PL/3PL: metrik normal-ogive. a dan b ditaksir dari korelasi biserial butir
  dengan skor sisa (pendekatan Lord/Urry; 3PL dikoreksi untuk tebakan), lalu
  fungsi logistiknya memakai D = 1,7 agar mendekati ogive normal.

θ ditaksir secara EAP (rata-rata posterior dengan prior normal baku), sehingga
estimasi tetap terhingga; θ = 0 adalah titik acuan prior, bukan jaminan rerata peserta.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from statistics import NormalDist

import numpy as np

from ..schemas.irt import AttemptScore, IrtAttempt, IrtRequest, IrtResponse, ItemParameter
from .answer_parser import coerce_bool
from .grading import _unique_strings, _dedupe_options

# Konstanta penskalaan logistik ke normal-ogive (2PL/3PL).
D_CONSTANT = 1.7
# D per model: harus sama dengan metrik tempat parameter butirnya ditaksir.
MODEL_D = {"1pl": 1.0, "2pl": D_CONSTANT, "3pl": D_CONSTANT}
B_BOUND = 4.0
EXTREME_SCORE_ADJUSTMENT = 0.3
_NORMAL = NormalDist()
# Titik kuadratur EAP pada −5..5 dengan prior normal baku.
_QUADRATURE = np.linspace(-5.0, 5.0, 101)
_LOG_PRIOR = -0.5 * _QUADRATURE**2

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
    # b 1PL (Rasch, D = 1) serta b 2PL/3PL (normal-ogive, D = 1,7).
    b: float = 0.0
    b_2pl: float = 0.0
    b_3pl: float = 0.0
    a: float = 1.0
    a_3pl: float = 1.0
    c: float = 0.2


@dataclass
class StudentData:
    attempt_id: str
    correct_item_ids: set[str] = field(default_factory=set)
    total_answered: int = 0
    essay_score_achieved: float = 0.0
    total_essay_weight: float = 0.0
    objective_raw_score: float = 0.0
    # Poin objektif yang benar-benar diperoleh. Nilai ini berbeda dari
    # ``objective_raw_score``: satu jawaban benar dapat berbobot 2, 5, atau 10
    # poin, sedangkan raw score selalu menghitung respons IRT biner.
    objective_score_achieved: float = 0.0
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
        return option.is_correct is not None and coerce_bool(parsed.get(option.id)) == option.is_correct

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

    return bool(correct) and _unique_strings(student) and set(student) == set(correct)


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
            weight = max(float(question.score_default), 0.0)

            if (question.metadata or {}).get("score_excluded") is True:
                # Soal dibatalkan: dikeluarkan dari bobot, kalibrasi, dan skor.
                continue

            if qtype in PERSONALITY_TYPES or weight == 0:
                # Diabaikan sepenuhnya: tipe psikometri tidak mengukur kemampuan.
                continue

            if qtype in ESSAY_TYPES:
                student.essay_score_achieved += min(max(float(answer.score or 0), 0.0), weight)
                student.total_essay_weight += weight
                continue

            # Skor klasik memakai poin berbobot yang sama dengan nilai utama
            # ujian. Baris jawaban kosong tetap mempunyai bobot maksimum dan
            # skor nol, sehingga soal yang tidak dijawab tidak menaikkan nilai.
            student.objective_weight += weight
            student.objective_score_achieved += min(
                max(float(answer.score or 0), 0.0), weight
            )

            if qtype in UNFOLDED_TYPES:
                # Tipe kompleks menyimpan JSON di essay_answer — tidak ada kolom
                # raw_answer di cbt_answers.
                parsed = _loads(answer.essay_answer)

                for option in _dedupe_options(question.bank_question_options):
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


def _clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def _correlation(x: np.ndarray, y: np.ndarray) -> float:
    """Korelasi Pearson; 0 bila salah satu variabel konstan."""
    sx, sy = float(x.std()), float(y.std())
    if sx == 0 or sy == 0:
        return 0.0
    return float(np.mean((x - x.mean()) * (y - y.mean())) / (sx * sy))


def _estimate_item_parameters(
    item_stats: dict[str, ItemStat],
    students: dict[str, StudentData],
    need_discrimination: bool,
) -> None:
    if not students:
        return

    student_list = list(students.values())
    raw = np.array([s.objective_raw_score for s in student_list], dtype=float)

    for item_id, stat in item_stats.items():
        p = stat.correct / stat.total if stat.total else 0.5
        p = _clamp(p, 0.01, 0.99)
        stat.p_value = p
        # 1PL (Rasch), metrik logistik D = 1: siswa dengan θ = b berpeluang 50%.
        stat.b = math.log((1 - p) / p)
        stat.b_2pl = stat.b_3pl = stat.b

        if not need_discrimination:
            continue

        # 2PL/3PL, metrik normal-ogive (pendekatan Lord/Urry): a dan b diturunkan
        # dari korelasi BISERIAL butir dengan skor sisa (skor total tanpa butir
        # ini), supaya butir tidak ikut berkorelasi dengan dirinya sendiri.
        u = np.array([1.0 if item_id in s.correct_item_ids else 0.0 for s in student_list])
        r_pb = _correlation(u, raw - u)
        gamma = _NORMAL.inv_cdf(1 - p)
        r_bis = r_pb * math.sqrt(p * (1 - p)) / _NORMAL.pdf(gamma)
        # r ≤ 0,1 berarti butir hampir tidak membedakan siswa (a ≈ 0,1).
        r_bis = _clamp(r_bis, 0.1, 0.95)
        stat.a = _clamp(r_bis / math.sqrt(1 - r_bis * r_bis), 0.1, 3.0)
        stat.b_2pl = _clamp(gamma / r_bis, -B_BOUND, B_BOUND)

        # 3PL: a dan b ditaksir dari peluang "benar-benar tahu" p' = (p − c)/(1 − c).
        # Tebakan meredam kovarians butir–skor dengan faktor (1 − c), sehingga
        # korelasi biserialnya juga dikoreksi dengan faktor itu.
        p_true = _clamp((p - stat.c) / (1 - stat.c), 0.01, 0.99)
        gamma_true = _NORMAL.inv_cdf(1 - p_true)
        r_true = r_pb * math.sqrt(p * (1 - p)) / ((1 - stat.c) * _NORMAL.pdf(gamma_true))
        r_true = _clamp(r_true, 0.1, 0.95)
        stat.a_3pl = _clamp(r_true / math.sqrt(1 - r_true * r_true), 0.1, 3.0)
        stat.b_3pl = _clamp(gamma_true / r_true, -B_BOUND, B_BOUND)


def _theta_score(
    student: StudentData,
    model: str,
    item_ids: list[str],
    a_all: np.ndarray,
    b_all: np.ndarray,
    c_all: np.ndarray,
    informative: np.ndarray | None = None,
) -> float:
    """Estimasi kemampuan θ secara EAP (rata-rata posterior, prior N(0, 1)).

    ``D`` mengikuti metrik parameter butir model yang sama (lihat ``MODEL_D``),
    sehingga θ dan b berada pada skala yang sama. EAP selalu terhingga, termasuk
    untuk skor sempurna/nol dan skor di bawah peluang tebakan 3PL, yang tidak
    punya estimasi maksimum-likelihood. ``informative`` menandai butir yang
    dijawab benar oleh sebagian (bukan semua/tidak satu pun) peserta; hanya butir
    itu yang membawa informasi tentang perbedaan kemampuan.
    """
    d = MODEL_D[model]
    u = np.array([1.0 if i in student.correct_item_ids else 0.0 for i in item_ids])
    if informative is None:
        informative = np.ones(len(item_ids), dtype=bool)

    if not informative.any():
        # Tidak ada butir pembeda (mis. hanya satu peserta): pakai log-odds
        # proporsi benar, digeser 0,3 butir agar skor sempurna/nol terhingga.
        count = len(u)
        share = _clamp((float(u.sum()) + EXTREME_SCORE_ADJUSTMENT * (1 - 2 * float(u.mean()))) / count, 0.01, 0.99)
        return round(math.log(share / (1 - share)) / d, 6)

    u = u[informative]
    b = b_all[informative]
    a = a_all[informative] if model in ("2pl", "3pl") else np.ones_like(b)
    c = c_all[informative] if model == "3pl" else np.zeros_like(b)

    # Peluang benar di setiap titik kuadratur: matriks titik × butir.
    z = np.clip(d * a[None, :] * (_QUADRATURE[:, None] - b[None, :]), -35.0, 35.0)
    p = np.clip(c + (1 - c) / (1.0 + np.exp(-z)), 1e-12, 1 - 1e-12)
    log_likelihood = np.log(p) @ u + np.log(1 - p) @ (1 - u)
    log_posterior = log_likelihood + _LOG_PRIOR
    weights = np.exp(log_posterior - log_posterior.max())
    theta = float(np.sum(weights * _QUADRATURE) / np.sum(weights))

    # Esai tetap masuk nilai klasikal. Poin esai tidak boleh dicampurkan dengan
    # theta karena satuannya berbeda dan esai belum dikalibrasi sebagai butir IRT.
    return round(theta, 6)


def calculate_exam_irt(request: IrtRequest) -> IrtResponse:
    scoring_types = {t.strip().lower() for t in request.scoring_types}
    calc_1pl = "irt_1pl" in scoring_types or "irt" in scoring_types
    calc_2pl = "irt_2pl" in scoring_types
    calc_3pl = "irt_3pl" in scoring_types

    if not (calc_1pl or calc_2pl or calc_3pl):
        raise IrtError("Tidak ada sistem penilaian IRT yang dipilih.")
    if not request.attempts:
        raise IrtError("Belum ada peserta yang menyelesaikan ujian.")

    participant_count = len(request.attempts)
    warnings: list[str] = []
    recommended_samples = [
        (calc_1pl, 100, "IRT 1PL"),
        (calc_2pl, 200, "IRT 2PL"),
        (calc_3pl, 500, "IRT 3PL"),
    ]
    for enabled, recommended, label in recommended_samples:
        if enabled and participant_count < recommended:
            warnings.append(
                f"{label} dihitung dari {participant_count} peserta; "
                f"hasil sebaiknya ditafsirkan hati-hati karena jumlah yang disarankan "
                f"sekurang-kurangnya {recommended} peserta."
            )

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
    if not item_stats:
        raise IrtError(
            "IRT memerlukan sedikitnya satu soal objektif. "
            "Ujian ini hanya berisi esai atau instrumen nonakademik."
        )
    _estimate_item_parameters(item_stats, students, need_discrimination=calc_2pl or calc_3pl)

    item_ids = list(item_stats.keys())
    a_by_model = {
        "2pl": np.array([item_stats[i].a for i in item_ids], dtype=float),
        "3pl": np.array([item_stats[i].a_3pl for i in item_ids], dtype=float),
    }
    a_by_model["1pl"] = np.ones(len(item_ids))
    # Butir yang dijawab benar oleh semua atau tidak satu pun peserta tidak
    # membedakan kemampuan, jadi tidak dipakai menaksir θ.
    informative = np.array([0 < item_stats[i].correct < item_stats[i].total for i in item_ids])
    b_by_model = {
        "1pl": np.array([item_stats[i].b for i in item_ids], dtype=float),
        "2pl": np.array([item_stats[i].b_2pl for i in item_ids], dtype=float),
        "3pl": np.array([item_stats[i].b_3pl for i in item_ids], dtype=float),
    }
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
                detailed["irt_1pl"] = None
            if calc_2pl:
                detailed["irt_2pl"] = None
            if calc_3pl:
                detailed["irt_3pl"] = None

            results.append(
                AttemptScore(id=attempt.id, detailed_scores=detailed, score_irt=None)
            )
            continue

        denominator = student.objective_weight + student.total_essay_weight
        classical = (
            (student.objective_score_achieved + student.essay_score_achieved)
            / denominator
            * 100
            if denominator
            else 0.0
        )
        detailed = {"classical": round(classical, 2)}

        if calc_1pl:
            detailed["irt_1pl"] = _theta_score(
                student, "1pl", item_ids, a_by_model["1pl"], b_by_model["1pl"], c_all, informative)
        if calc_2pl:
            detailed["irt_2pl"] = _theta_score(
                student, "2pl", item_ids, a_by_model["2pl"], b_by_model["2pl"], c_all, informative)
        if calc_3pl:
            detailed["irt_3pl"] = _theta_score(
                student, "3pl", item_ids, a_by_model["3pl"], b_by_model["3pl"], c_all, informative)

        # Pilih model tertinggi yang memang dikonfigurasi. Jangan memakai `or`:
        # skor sah 0,00 bersifat falsy dan dulu dapat tergantikan oleh model lain.
        if calc_3pl:
            score_irt = detailed["irt_3pl"]
        elif calc_2pl:
            score_irt = detailed["irt_2pl"]
        elif calc_1pl:
            score_irt = detailed["irt_1pl"]
        else:
            score_irt = detailed["classical"]
        results.append(
            AttemptScore(id=attempt.id, detailed_scores=detailed, score_irt=score_irt)
        )

    # Parameter yang ditampilkan mengikuti model tertinggi, sama seperti score_irt.
    def displayed_b(stat: ItemStat) -> float:
        return stat.b_3pl if calc_3pl else stat.b_2pl if calc_2pl else stat.b

    def displayed_a(stat: ItemStat) -> float:
        return stat.a_3pl if calc_3pl else stat.a

    items = [
        ItemParameter(
            item_id=item_id,
            total=stat.total,
            correct=stat.correct,
            p_value=round(stat.p_value, 4),
            b=round(displayed_b(stat), 4),
            a=round(displayed_a(stat), 4),
            c=round(stat.c, 4),
        )
        for item_id, stat in item_stats.items()
    ]

    return IrtResponse(count=len(results), attempts=results, items=items, warnings=warnings)
