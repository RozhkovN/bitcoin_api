FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/bitcoin_api .

FROM alpine:3.20

WORKDIR /app

RUN adduser -D -u 10001 appuser
COPY --from=builder /bin/bitcoin_api /app/bitcoin_api

ENV PORT=3400
ENV OPEN_BROWSER=false

EXPOSE 3400

USER appuser
ENTRYPOINT ["/app/bitcoin_api"]
