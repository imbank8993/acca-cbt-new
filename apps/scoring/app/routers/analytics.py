from fastapi import APIRouter, Depends

from ..schemas.analytics import (
    ExamAnalyticsRequest,
    ExamAnalyticsResponse,
    ItemAnalysisRequest,
    ItemAnalysisResponse,
)
from ..security import require_api_key
from ..services.analytics import analyze_items, build_exam_analytics

router = APIRouter(
    prefix="/analytics", tags=["analytics"], dependencies=[Depends(require_api_key)]
)


@router.post("/exam", response_model=ExamAnalyticsResponse)
def exam_analytics(request: ExamAnalyticsRequest) -> ExamAnalyticsResponse:
    """Ringkasan hasil ujian: statistik nilai, sebaran, dan rekap per soal."""
    return build_exam_analytics(request)


@router.post("/items", response_model=ItemAnalysisResponse)
def item_analysis(request: ItemAnalysisRequest) -> ItemAnalysisResponse:
    """Indeks kesukaran dan daya beda per butir."""
    return analyze_items(request)
