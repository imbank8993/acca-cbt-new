from __future__ import annotations

from pydantic import BaseModel, Field


class AnalyticsAnswer(BaseModel):
    attempt_id: str
    question_id: str
    is_correct: bool | None = None
    score: float | None = None
    selected_option_id: str | None = None


class AnalyticsQuestion(BaseModel):
    id: str
    question_text: str | None = None
    type: str | None = None
    difficulty: str | None = None


class AnalyticsAttempt(BaseModel):
    id: str
    status: str | None = None
    total_score: float | None = None


class ExamAnalyticsRequest(BaseModel):
    exam_id: str
    exam_title: str | None = None
    attempts: list[AnalyticsAttempt] = Field(default_factory=list)
    questions: list[AnalyticsQuestion] = Field(default_factory=list)
    answers: list[AnalyticsAnswer] = Field(default_factory=list)
    finished_statuses: list[str] = Field(
        default_factory=lambda: ["submitted", "auto_submitted"]
    )


class ScoreStats(BaseModel):
    average: float
    median: float
    highest: float
    lowest: float
    total: float
    completed: int


class ScoreDistributionBucket(BaseModel):
    range: str
    count: int
    percentage: int


class QuestionAnalytics(BaseModel):
    question_id: str
    question_text: str | None = None
    question_type: str | None = None
    total_attempts: int
    correct_count: int
    wrong_count: int
    unanswered_count: int
    correct_percentage: int
    difficulty: str


class ExamAnalyticsResponse(BaseModel):
    exam_id: str
    exam_title: str | None = None
    total_participants: int
    completed_count: int
    in_progress_count: int
    score_stats: ScoreStats
    question_analytics: list[QuestionAnalytics]
    score_distribution: list[ScoreDistributionBucket]


class ItemStatistic(BaseModel):
    question_id: str
    respondents: int
    difficulty_index: float
    difficulty_label: str
    discrimination_index: float
    discrimination_label: str


class ItemAnalysisRequest(BaseModel):
    questions: list[AnalyticsQuestion] = Field(default_factory=list)
    answers: list[AnalyticsAnswer] = Field(default_factory=list)
    # Proporsi kelompok atas/bawah untuk indeks daya beda. 0,27 adalah konvensi
    # klasik (Kelley) yang memaksimalkan keandalan pembedaan.
    group_fraction: float = 0.27


class ItemAnalysisResponse(BaseModel):
    items: list[ItemStatistic]
    respondents: int
