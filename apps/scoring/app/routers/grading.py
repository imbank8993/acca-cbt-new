from fastapi import APIRouter, Depends

from ..schemas.grading import (
    GradeAnswerRequest,
    GradeBatchRequest,
    GradeBatchResponse,
    GradedItem,
    GradingResult,
    RelativeScoringRequest,
    RelativeScoringResponse,
)
from ..security import require_api_key
from ..services.grading import (
    ESSAY_TYPES,
    apply_relative_scoring,
    calculate_single_answer_score,
    is_academic_type,
    scale_to_hundred,
)

router = APIRouter(prefix="/grading", tags=["grading"], dependencies=[Depends(require_api_key)])


@router.post("/answer", response_model=GradingResult)
def grade_answer(request: GradeAnswerRequest) -> GradingResult:
    """Nilai satu jawaban. Berguna untuk umpan balik langsung dan pengujian."""
    return calculate_single_answer_score(request.question, request.raw_answer)


@router.post("/attempt", response_model=GradeBatchResponse)
def grade_attempt(request: GradeBatchRequest) -> GradeBatchResponse:
    """Nilai seluruh jawaban satu attempt sekaligus.

    Bentuk keluarannya mengikuti ``gradeAttemptFromSavedAnswers``: skor per
    jawaban untuk ditulis ke ``cbt_answers``, ditambah nilai akhir skala 0–100.
    """
    items: list[GradedItem] = []
    total_score = 0.0
    max_possible = 0.0
    needs_manual = False
    dimension_totals: dict[str, float] = {}

    for entry in request.items:
        question = entry.question
        qtype = (question.type or "").lower()
        default_score = question.score_default or 1

        # Tipe psikometri dikecualikan dari nilai akademik, sehingga ujian
        # campuran tidak pernah melewati 100.
        if is_academic_type(qtype):
            max_possible += default_score

        if qtype in ESSAY_TYPES:
            # Esai dinilai manual; tidak ikut dihitung di sini.
            needs_manual = True
            continue

        result = calculate_single_answer_score(question, entry.raw_answer)
        total_score += result.score

        for dimension, value in result.dimension_scores.items():
            dimension_totals[dimension] = dimension_totals.get(dimension, 0) + value

        items.append(
            GradedItem(
                answer_id=entry.answer_id,
                question_id=question.id,
                score=result.score,
                is_correct=result.is_correct,
                dimension_scores=result.dimension_scores,
            )
        )

    return GradeBatchResponse(
        items=items,
        total_score=total_score,
        max_possible_score=max_possible,
        scaled_score=scale_to_hundred(total_score, max_possible),
        needs_manual_grading=needs_manual,
        dimension_scores=dimension_totals,
    )


@router.post("/relative", response_model=RelativeScoringResponse)
def relative_scoring(request: RelativeScoringRequest) -> RelativeScoringResponse:
    """Terapkan penalti kecepatan pada kuis berskor relatif."""
    return RelativeScoringResponse(scores=apply_relative_scoring(request.attempts))
