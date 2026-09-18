"""Uji paritas mesin penilaian Python terhadap implementasi TypeScript asli.

Fixture ``grading-expected-ts.json`` dihasilkan dengan menjalankan
``calculateSingleAnswerScore`` yang ASLI dari ``apps/web/app/actions/grading.ts``
atas ``grading-cases.json``. Regenerasi::

    node tools/gen-grading-cases.js

Uji ini yang menahan supaya nilai siswa tidak bergeser saat penilaian pindah ke
FastAPI. Ada satu selisih yang memang disengaja, dijelaskan di bawah.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.schemas.grading import Question
from app.services.grading import calculate_single_answer_score

FIXTURES = Path(__file__).parent / "fixtures"

with (FIXTURES / "grading-cases.json").open(encoding="utf-8") as fh:
    CASES = json.load(fh)
with (FIXTURES / "grading-expected-ts.json").open(encoding="utf-8") as fh:
    EXPECTED = json.load(fh)

# Satu-satunya selisih yang diterima.
#
# Untuk pilihan ganda dengan jawaban string kosong, versi TypeScript menghasilkan
# is_correct = "" — bukan boolean maupun null — karena operator && di JavaScript
# mengembalikan operan yang falsy. Nilai itu melanggar tipe yang dideklarasikan
# sendiri (`boolean | null`), dan PostgreSQL menolaknya sebagai masukan boolean.
# Python mengembalikan None, yang sesuai tipe dan tersimpan sebagai NULL.
#
# Tidak ada perubahan perilaku nyata: setiap pemanggil menormalkan nilai falsy
# menjadi NULL, atau menjaga agar cabang ini tidak pernah tercapai dengan
# memeriksa rawAnswer lebih dulu.
JS_FALSY_QUIRK_INDEXES = {1}


def _normalize_js(value):
    """Petakan nilai falsy ala JavaScript ke None, seperti yang dilakukan pemanggil."""
    if value is True or value is False:
        return value
    return None


@pytest.mark.parametrize("index", range(len(CASES)))
def test_grading_matches_typescript(index: int) -> None:
    case = CASES[index]
    expected = EXPECTED[index]

    result = calculate_single_answer_score(Question(**case["question"]), case["raw_answer"])

    assert result.score == pytest.approx(expected["score"]), (
        f"[{index}] {case['label']}: skor berbeda"
    )
    assert result.dimension_scores == pytest.approx(expected["dimensionScores"]), (
        f"[{index}] {case['label']}: skor dimensi berbeda"
    )

    expected_correct = expected["isCorrect"]
    if index in JS_FALSY_QUIRK_INDEXES:
        expected_correct = _normalize_js(expected_correct)

    assert result.is_correct == expected_correct, (
        f"[{index}] {case['label']}: is_correct berbeda"
    )


def test_fixture_covers_every_question_type() -> None:
    """Jaga agar tipe soal baru tidak lolos tanpa kasus uji."""
    from app.services.grading import ESSAY_TYPES, PERSONALITY_TYPES

    covered = {c["question"]["type"] for c in CASES}
    required = {
        "mcq",
        "mcq_complex",
        "true_false",
        "categorization",
        "matching",
        "short_answer",
        "ordering",
        "ranking",
        *ESSAY_TYPES,
        *PERSONALITY_TYPES,
    }
    missing = required - covered
    assert not missing, f"tipe soal tanpa kasus uji: {sorted(missing)}"
