# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend

# Install deps first (layer cache)
COPY frontend/package*.json ./
RUN npm ci --prefer-offline

# Build (output → ../backend/static per vite.config.ts)
COPY frontend/ .
RUN npm run build


# ─── Stage 2: Build Go backend ───────────────────────────────────────────────
FROM golang:1.25-alpine AS backend-builder

WORKDIR /build/backend

# Download deps (layer cache)
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy source + embedded static from stage 1
COPY backend/ .
COPY --from=frontend-builder /build/backend/static ./static

# Pure Go SQLite (no CGo needed with modernc.org/sqlite)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o forensics .


# ─── Stage 3: Minimal runtime image ──────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=backend-builder /build/backend/forensics ./forensics

# SQLite DB lives on a persistent volume
VOLUME ["/data"]
ENV FORENSICS_DB_PATH=/data/forensics_cache.db
ENV PORT=3400
ENV OPEN_BROWSER=false

EXPOSE 3400
# Ensure runtime user can write app files and /data mountpoint.
# For named volumes Docker copies ownership from this mountpoint on first init.
RUN mkdir -p /data && chown -R app:app /app /data
USER app
ENTRYPOINT ["./forensics"]
