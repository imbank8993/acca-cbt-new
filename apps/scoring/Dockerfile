FROM python:3.11-slim

WORKDIR /app

# Hindari pembuatan berkas .pyc dan pastikan log langsung muncul di stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Salin dan pasang pustaka Python
COPY apps/scoring/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Salin kode sumber layanan skoring
COPY apps/scoring/app ./app

EXPOSE 8000

# Pemeriksaan kesehatan berkala untuk Docker daemon
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
