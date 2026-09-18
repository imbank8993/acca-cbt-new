import hmac

from fastapi import Header, HTTPException, status

from .config import get_settings


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Pastikan pemanggil menyertakan kunci antar-service yang benar.

    Dibandingkan dengan ``compare_digest`` agar waktu pemeriksaannya tidak
    bergantung pada berapa banyak karakter awal yang cocok.
    """
    expected = get_settings().scoring_api_key
    if not expected:
        # Tanpa kunci terkonfigurasi, layanan menolak semua permintaan alih-alih
        # membuka diri. Salah konfigurasi harus terlihat, bukan diam-diam permisif.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SCORING_API_KEY belum dikonfigurasi di layanan skoring.",
        )

    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kunci API tidak valid.",
        )
