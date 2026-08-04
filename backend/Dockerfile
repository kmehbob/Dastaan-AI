FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_CACHE_DIR=/models

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system tarjuma \
    && useradd --system --gid tarjuma --create-home tarjuma \
    && mkdir -p /app /models \
    && chown -R tarjuma:tarjuma /app /models

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --requirement requirements.txt

COPY --chown=tarjuma:tarjuma app ./app
USER tarjuma

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
