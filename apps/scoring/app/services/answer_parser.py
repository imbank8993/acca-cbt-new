"""Port dari ``apps/web/lib/answer-parser.ts``.

Perilakunya harus sama persis dengan versi TypeScript: kedua sisi menilai
jawaban yang sama, dan selisih sekecil apa pun berarti nilai yang ditampilkan ke
siswa berbeda dari nilai yang tersimpan.
"""

from __future__ import annotations

import json
from typing import Any


def parse_answer(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return fallback


def parse_mcq_complex_answer(value: Any) -> list[str]:
    """Baca jawaban pilihan ganda kompleks dengan toleransi bentuk warisan.

    Dua bentuk lama yang kalau dijatuhkan ke ``[]`` akan MENGHAPUS jawaban siswa:
    id tunggal telanjang (sisa soal yang dulu bertipe ``mcq``), dan string
    gabungan dipisah koma dari klien lama.
    """
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(v) for v in value]

    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed == "":
            return []
        try:
            parsed = json.loads(trimmed)
        except (ValueError, TypeError):
            return [s.strip() for s in trimmed.split(",") if s.strip()]

        if isinstance(parsed, list):
            return [str(v) for v in parsed]
        # JSON valid tapi bukan array (mis. sebuah id ber-tanda-kutip).
        return [] if str(parsed).strip() == "" else [str(parsed)]

    result = parse_answer(value, [])
    return [str(v) for v in result] if isinstance(result, list) else []


def normalize_short_answer(value: str | None) -> str:
    """Normalisasi isian singkat untuk pembandingan.

    Pencocokan sengaja PERSIS: hanya trim dan lowercase. Spasi di tengah TIDAK
    diubah — "x+y" dan "x + y" tetap berbeda. Pembuat soal yang mendaftarkan
    sendiri setiap variasi jawaban yang diterima.
    """
    return value.strip().lower() if isinstance(value, str) else ""


def coerce_bool(value: Any) -> bool | None:
    """Terjemahkan pilihan benar/salah siswa dalam berbagai bentuk penulisan."""
    if value is True or value in ("true", "benar"):
        return True
    if value is False or value in ("false", "salah"):
        return False
    return None
