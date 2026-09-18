"""Integrasi AI — port dari ``apps/web/app/actions/ai.ts``.

Catatan keamanan: versi TypeScript-nya menuliskan kunci OpenAI langsung di kode
sebagai nilai cadangan::

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-cp-OU4o...';

Kunci itu ada di dalam riwayat git dan harus dianggap bocor. Di sini tidak ada
nilai cadangan: tanpa ``OPENAI_API_KEY`` yang dikonfigurasi, endpoint AI menolak
permintaan dengan pesan yang jelas.
"""

from __future__ import annotations

from ..config import get_settings


class AiNotConfiguredError(RuntimeError):
    pass


def _client():
    settings = get_settings()
    if not settings.openai_api_key:
        raise AiNotConfiguredError(
            "OPENAI_API_KEY belum dikonfigurasi pada layanan skoring."
        )
    # Diimpor saat dipakai agar layanan tetap bisa dijalankan (penilaian dan IRT
    # berfungsi normal) di lingkungan yang tidak memakai fitur AI.
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


def generate_kisi_kisi(question_text: str, options: list[str] | None = None) -> str:
    """Susun kisi-kisi (KD, indikator, level kognitif) untuk satu soal."""
    options_text = ""
    if options:
        listed = "\n".join(f"{chr(65 + i)}. {o}" for i, o in enumerate(options))
        options_text = f"\n\nPilihan Jawaban:\n{listed}"

    prompt = (
        "Anda adalah pakar kurikulum Indonesia.\n"
        "Buat Kisi-kisi: KD: [Kompetensi Dasar], Indikator: [Indikator], "
        "Level: [LOTS/MOTS/HOTS]\n\n"
        f'Soal: "{question_text}"{options_text}'
    )

    settings = get_settings()
    response = _client().chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=300,
    )

    content = (response.choices[0].message.content or "").strip()
    return content or "Gagal menghasilkan kisi-kisi."


def suggest_essay_score(
    question_text: str,
    rubric: str | None,
    student_answer: str,
    max_score: float,
) -> dict:
    """Usulkan nilai esai beserta alasannya.

    Hasilnya SARAN, bukan keputusan: pemanggil menyimpannya sebagai usulan yang
    masih harus disetujui guru. Nilai yang ditulis ke ``cbt_answers`` tetap
    berasal dari tindakan manusia.
    """
    rubric_text = f"\n\nRubrik penilaian:\n{rubric}" if rubric else ""
    prompt = (
        "Anda adalah guru berpengalaman yang menilai jawaban esai siswa Indonesia.\n"
        f"Nilai maksimum untuk soal ini adalah {max_score}.\n"
        "Jawab HANYA dalam format:\nSKOR: <angka>\nALASAN: <satu paragraf singkat>\n\n"
        f"Soal: {question_text}{rubric_text}\n\n"
        f"Jawaban siswa: {student_answer}"
    )

    settings = get_settings()
    response = _client().chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=400,
    )

    content = (response.choices[0].message.content or "").strip()

    score: float | None = None
    reason = content
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("SKOR:"):
            try:
                score = float(stripped.split(":", 1)[1].strip().replace(",", "."))
            except ValueError:
                score = None
        elif stripped.upper().startswith("ALASAN:"):
            reason = stripped.split(":", 1)[1].strip()

    if score is not None:
        # Jangan pernah mengusulkan nilai di luar rentang soal, seberapa pun
        # yakinnya model.
        score = min(max(score, 0.0), max_score)

    return {"suggested_score": score, "reason": reason, "raw": content}
