FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends util-linux texlive-latex-extra texlive-xetex texlive-fonts-recommended fonts-lmodern && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY server.py ./server.py
USER 65534:65534
EXPOSE 8010
CMD ["python", "-B", "server.py"]
