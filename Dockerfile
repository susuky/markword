# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MARKWORD_FRONTEND_DIR=/app/frontend/dist \
    MARKWORD_EXPORT_DIR=/app/exports

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        fonts-noto-cjk \
        libcairo2 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN groupadd --system markword \
    && useradd --system --gid markword --create-home --home-dir /home/markword --shell /usr/sbin/nologin markword

COPY --chown=markword:markword . .
COPY --chown=markword:markword --from=frontend-build /build/frontend/dist ./frontend/dist

RUN mkdir -p /app/exports \
    && chown -R markword:markword /app/exports

USER markword
EXPOSE 27860

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "27860"]
