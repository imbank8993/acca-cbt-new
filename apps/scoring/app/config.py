from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Konfigurasi layanan skoring.

    Tidak ada DATABASE_URL di sini — dan itu disengaja. NestJS tetap satu-satunya
    pemilik akses database; layanan ini menerima data lewat payload, menghitung,
    lalu mengembalikan hasilnya. Dengan begitu otorisasi dan kepemilikan data
    hanya ditegakkan di satu tempat.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8000

    scoring_api_key: str = ""

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
