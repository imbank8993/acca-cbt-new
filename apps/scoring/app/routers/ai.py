from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..security import require_api_key
from ..services.ai import AiNotConfiguredError, generate_kisi_kisi, suggest_essay_score

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(require_api_key)])


class KisiKisiRequest(BaseModel):
    question_text: str
    options: list[str] = Field(default_factory=list)


class KisiKisiResponse(BaseModel):
    kisi: str


class EssayScoreRequest(BaseModel):
    question_text: str
    student_answer: str
    max_score: float = 1
    rubric: str | None = None


class EssayScoreResponse(BaseModel):
    suggested_score: float | None
    reason: str
    raw: str


def _guard(call):
    try:
        return call()
    except AiNotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    except Exception as error:  # noqa: BLE001 — pesan penyedia diteruskan apa adanya
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Layanan AI gagal: {error}",
        ) from error


@router.post("/kisi-kisi", response_model=KisiKisiResponse)
def kisi_kisi(request: KisiKisiRequest) -> KisiKisiResponse:
    kisi = _guard(lambda: generate_kisi_kisi(request.question_text, request.options))
    return KisiKisiResponse(kisi=kisi)


@router.post("/essay-score", response_model=EssayScoreResponse)
def essay_score(request: EssayScoreRequest) -> EssayScoreResponse:
    """Usulkan nilai esai. Hasilnya saran; keputusan tetap di tangan guru."""
    result = _guard(
        lambda: suggest_essay_score(
            request.question_text, request.rubric, request.student_answer, request.max_score
        )
    )
    return EssayScoreResponse(**result)
