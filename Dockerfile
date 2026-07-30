FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_URL=sqlite:////data/networth.db

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends cron sqlite3 tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
RUN chmod +x /app/scripts/*.sh
RUN mkdir -p /data /backups

EXPOSE 8000

ENTRYPOINT ["/app/scripts/app-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
