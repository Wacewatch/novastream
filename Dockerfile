# =========================================================================
# NovaStream — image applicative unique (frontend buildé + backend FastAPI)
# =========================================================================
# Stage 1 : build du frontend React (CRA)
# Stage 2 : runtime Python qui sert le backend FastAPI + le static React
# =========================================================================

# ---------- Stage 1 : build frontend ----------
FROM node:20-bookworm-slim AS frontend-builder

ENV CI=true \
    GENERATE_SOURCEMAP=false \
    DISABLE_ESLINT_PLUGIN=true

WORKDIR /app

COPY frontend/package.json frontend/yarn.lock* frontend/package-lock.json* ./

RUN if [ -f yarn.lock ]; then \
      yarn install --network-timeout 600000 --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      yarn install --network-timeout 600000; \
    fi

COPY frontend/ ./

ARG REACT_APP_BACKEND_URL
ARG REACT_APP_SUPABASE_URL
ARG REACT_APP_SUPABASE_ANON_KEY
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL \
    REACT_APP_SUPABASE_URL=$REACT_APP_SUPABASE_URL \
    REACT_APP_SUPABASE_ANON_KEY=$REACT_APP_SUPABASE_ANON_KEY

RUN if [ -f yarn.lock ]; then yarn build; else npm run build; fi


# ---------- Stage 2 : runtime backend + static ----------
FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
        build-essential \
        gcc \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

RUN groupadd -g 10001 novastream \
    && useradd -u 10001 -g 10001 -m -s /bin/bash novastream

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

# Purge build deps une fois les wheels installés (image plus légère)
RUN apt-get purge -y --auto-remove build-essential gcc libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/*.py /app/

# Static React buildé au stage 1
COPY --from=frontend-builder /app/build /app/static

RUN chown -R novastream:novastream /app

USER novastream

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8001/api/ || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["sh", "-c", "exec uvicorn server:app \
    --host 0.0.0.0 \
    --port 8001 \
    --workers ${UVICORN_WORKERS:-1} \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --timeout-keep-alive 75 \
    --log-level ${LOG_LEVEL:-info}"]
