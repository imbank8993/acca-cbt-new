from __future__ import annotations

from typing import Any
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


class DetailedOptionInput(BaseModel):
    id: str
    option_text: str | None = None
    is_correct: bool = False
    order: int | None = 0
    # Kunci Kategorisasi/Menjodohkan (category_names, match_texts) ada di sini.
    metadata: dict[str, Any] | None = None


class DetailedQuestionInput(BaseModel):
    id: str
    number: int | None = 0
    question_text: str | None = ""
    type: str | None = "mcq"
    score_default: float | None = 1.0
    options: list[DetailedOptionInput] = Field(default_factory=list)
    # Kunci Isian (blanks) dan Urutan (correct_order).
    metadata: dict[str, Any] | None = None


class DetailedParticipantInput(BaseModel):
    attempt_id: str
    user_id: str | None = None
    student_name: str
    student_nis: str | None = "-"
    class_name: str | None = "-"
    status: str | None = "submitted"
    total_score: float | None = None


class DetailedAnswerInput(BaseModel):
    attempt_id: str
    question_id: str
    is_correct: bool | None = None
    score: float | None = None
    selected_option_id: str | None = None
    essay_answer: Any | None = None


class DetailedItemAnalysisRequest(BaseModel):
    exam_id: str
    questions: list[DetailedQuestionInput] = Field(default_factory=list)
    participants: list[DetailedParticipantInput] = Field(default_factory=list)
    answers: list[DetailedAnswerInput] = Field(default_factory=list)
    group_fraction: float = 0.27


class AnswerPart(BaseModel):
    """Jawaban siswa untuk satu pernyataan (B/S, Kategorisasi, Menjodohkan)."""

    label: str
    value: str = "-"
    # None = belum dapat dinilai (kunci tidak tersedia).
    correct: bool | None = None


class KeyPart(BaseModel):
    """Kunci satu pernyataan, ditampilkan sekali di atas daftar siswa."""

    label: str
    text: str = ""
    value: str = "-"


class ResponseChoice(BaseModel):
    """Satu kemungkinan jawaban dalam sebaran: opsi, Benar/Salah, kategori, atau isian siswa."""

    value: str
    text: str = ""
    is_key: bool = False
    count: int = 0
    percentage: float = 0.0
    # Proporsi kelompok atas dikurangi kelompok bawah (27%) yang memilih jawaban ini.
    # Kunci seharusnya positif, pengecoh negatif. None bila kelompok terlalu kecil.
    discrimination: float | None = None
    # "nonfunctional" (pengecoh dipilih < 5%), "attracts_upper" (pengecoh disukai kelompok atas),
    # "key_negative" (kunci lebih banyak dipilih kelompok bawah — periksa kemungkinan salah kunci).
    flags: list[str] = Field(default_factory=list)
    students: list[str] = Field(default_factory=list)


class ResponseGroup(BaseModel):
    """Sebaran jawaban untuk satu bagian soal: seluruh soal (PG/PGK), satu pernyataan,
    satu posisi urutan, atau satu isian."""

    id: str
    kind: str  # single | multi | statement | position | free
    label: str = ""
    text: str = ""
    correct_percentage: float = 0.0
    empty: int = 0
    choices: list[ResponseChoice] = Field(default_factory=list)


class StudentAnswerSummary(BaseModel):
    attempt_id: str
    student_name: str
    class_name: str | None = "-"
    student_nis: str | None = "-"
    score: float = 0.0
    display_answer: str = "-"
    is_correct: bool | None = None
    answer_parts: list[AnswerPart] = Field(default_factory=list)


class DistractorOptionStat(BaseModel):
    option_id: str
    option_letter: str
    option_text: str
    is_correct: bool
    count: int
    percentage: float
    student_names: list[str] = Field(default_factory=list)


class DetailedItemResult(BaseModel):
    id: str
    number: int
    question_text: str
    type: str
    score_default: float
    key_display: str
    options: list[DetailedOptionInput] = Field(default_factory=list)
    total_participants: int
    total_answered: int
    total_correct: int
    total_incorrect: int
    total_ungraded: int
    total_unanswered: int
    incorrect_percentage: float
    difficulty_index: float
    difficulty_label: str
    discrimination_index: float
    discrimination_label: str
    correct_students: list[StudentAnswerSummary] = Field(default_factory=list)
    wrong_students: list[StudentAnswerSummary] = Field(default_factory=list)
    ungraded_students: list[StudentAnswerSummary] = Field(default_factory=list)
    unanswered_students: list[StudentAnswerSummary] = Field(default_factory=list)
    distractor_distribution: list[DistractorOptionStat] = Field(default_factory=list)
    key_parts: list[KeyPart] = Field(default_factory=list)
    response_distribution: list[ResponseGroup] = Field(default_factory=list)


class StudentItemCell(BaseModel):
    score: float = 0.0
    is_correct: bool | None = None
    display_answer: str = "-"
    status: str = "unanswered"  # 'correct', 'wrong', 'ungraded', 'unanswered'


class StudentItemMatrixRow(BaseModel):
    attempt_id: str
    student_name: str
    student_nis: str | None = "-"
    class_name: str | None = "-"
    status: str = "submitted"
    total_score: float = 0.0
    total_correct: int = 0
    total_wrong: int = 0
    total_unanswered: int = 0
    items: dict[str, StudentItemCell] = Field(default_factory=dict)


class DetailedItemAnalysisResponse(BaseModel):
    exam_id: str
    total_questions: int
    total_participants: int
    items: list[DetailedItemResult] = Field(default_factory=list)
    matrix: list[StudentItemMatrixRow] = Field(default_factory=list)
