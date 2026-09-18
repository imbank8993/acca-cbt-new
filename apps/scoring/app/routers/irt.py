from fastapi import APIRouter, Depends, HTTPException, status

from ..schemas.irt import IrtRequest, IrtResponse
from ..security import require_api_key
from ..services.irt import IrtError, calculate_exam_irt

router = APIRouter(prefix="/irt", tags=["irt"], dependencies=[Depends(require_api_key)])


@router.post("/calculate", response_model=IrtResponse)
def calculate(request: IrtRequest) -> IrtResponse:
    """Hitung theta dan skor IRT (1PL/2PL/3PL) untuk seluruh peserta satu ujian."""
    try:
        return calculate_exam_irt(request)
    except IrtError as error:
        # Kondisi seperti "esai belum dinilai" adalah masalah data, bukan galat
        # server. Dikembalikan 422 agar NestJS bisa meneruskan pesannya apa adanya
        # ke guru, bukan menampilkan "terjadi kesalahan".
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
        ) from error
