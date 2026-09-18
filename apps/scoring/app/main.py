import logging

from fastapi import FastAPI

from .config import get_settings
from .routers import ai, analytics, grading, irt

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())

app = FastAPI(
    title="ACCA CBT Scoring Service",
    description=(
        "Layanan penilaian, IRT, analitik butir, dan integrasi AI untuk CBT. "
        "Dipanggil hanya oleh NestJS dari mesin yang sama; tidak punya akses database."
    ),
    version="1.0.0",
    docs_url="/docs",
)

app.include_router(grading.router)
app.include_router(irt.router)
app.include_router(analytics.router)
app.include_router(ai.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    """Pemeriksaan kesehatan. Sengaja tanpa kunci API agar NestJS bisa memantau."""
    return {
        "ok": True,
        "service": "acca-cbt-scoring",
        "ai_configured": bool(settings.openai_api_key),
    }
