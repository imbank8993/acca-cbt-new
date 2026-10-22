from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class IrtOption(BaseModel):
    id: str
    is_correct: bool | None = None
    weight: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class IrtQuestion(BaseModel):
    type: str = "mcq"
    score_default: float = 1
    metadata: dict[str, Any] = Field(default_factory=dict)
    bank_question_options: list[IrtOption] = Field(default_factory=list)


class IrtAnswer(BaseModel):
    question_id: str
    is_correct: bool | None = None
    score: float | None = None
    essay_answer: str | None = None
    selected_option_id: str | None = None
    bank_questions: IrtQuestion | None = None


class IrtAttempt(BaseModel):
    id: str
    user_id: str | None = None
    needs_manual_grading: bool | None = False
    answers: list[IrtAnswer] = Field(default_factory=list)


class IrtRequest(BaseModel):
    """Data mentah untuk perhitungan IRT.

    NestJS yang mengambilnya dari database; layanan ini tidak pernah menyentuh
    PostgreSQL. ``scoring_types`` mengikuti isi kolom ``cbt_exams.scoring_type``
    (dipisah koma), mis. "classical,irt_2pl".
    """

    exam_id: str
    scoring_types: list[str] = Field(default_factory=lambda: ["classical"])
    attempts: list[IrtAttempt] = Field(default_factory=list)


class ItemParameter(BaseModel):
    item_id: str
    total: int
    correct: int
    p_value: float
    b: float
    a: float
    c: float


class AttemptScore(BaseModel):
    id: str
    detailed_scores: dict[str, float]
    score_irt: float


class IrtResponse(BaseModel):
    count: int
    attempts: list[AttemptScore]
    # Parameter butir dikembalikan juga: analisis butir memakainya, dan tanpa ini
    # perhitungan yang sama harus diulang di tempat lain.
    items: list[ItemParameter] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
