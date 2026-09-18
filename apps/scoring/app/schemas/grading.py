from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class QuestionOption(BaseModel):
    id: str
    option_text: str | None = None
    is_correct: bool | None = None
    weight: float | None = None
    order: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Question(BaseModel):
    id: str
    type: str
    score_default: float = 1
    dimension_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    # Nama field mengikuti alias relasi di query CBT supaya payload bisa
    # diteruskan apa adanya dari NestJS tanpa pemetaan tambahan.
    bank_question_options: list[QuestionOption] = Field(default_factory=list)


class GradeAnswerRequest(BaseModel):
    question: Question
    raw_answer: str | None = None


class GradingResult(BaseModel):
    score: float
    is_correct: bool | None
    dimension_scores: dict[str, float] = Field(default_factory=dict)


class GradeBatchItem(BaseModel):
    question: Question
    raw_answer: str | None = None
    answer_id: str | None = None


class GradeBatchRequest(BaseModel):
    items: list[GradeBatchItem]


class GradedItem(BaseModel):
    answer_id: str | None = None
    question_id: str
    score: float
    is_correct: bool | None
    dimension_scores: dict[str, float] = Field(default_factory=dict)


class GradeBatchResponse(BaseModel):
    items: list[GradedItem]
    total_score: float
    max_possible_score: float
    scaled_score: float
    needs_manual_grading: bool
    dimension_scores: dict[str, float] = Field(default_factory=dict)


class RelativeAttempt(BaseModel):
    """Satu attempt untuk perhitungan penalti kecepatan."""

    attempt_id: str
    base_score: float = 0
    duration_seconds: int = 0


class RelativeScoringRequest(BaseModel):
    attempts: list[RelativeAttempt]


class RelativeScoringResponse(BaseModel):
    """Peta attempt_id → nilai akhir setelah penalti kecepatan."""

    scores: dict[str, float]
