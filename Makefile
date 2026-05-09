.PHONY: dev build docker clean frontend backend

# ─── Paths ───────────────────────────────────────────────────────────────────
FRONTEND_DIR := frontend
BACKEND_DIR  := backend
BINARY       := $(BACKEND_DIR)/forensics

# ─── Dev: run Vite + Go in parallel ─────────────────────────────────────────
dev:
	@echo "→ Starting Vite dev server and Go backend..."
	@trap 'kill 0' INT; \
	  (cd $(FRONTEND_DIR) && npm run dev) & \
	  (cd $(BACKEND_DIR)  && OPEN_BROWSER=false go run .) & \
	  wait

# ─── Build: compile frontend → embed into Go binary ──────────────────────────
build: frontend backend

frontend:
	@echo "→ Building React frontend..."
	rm -rf $(BACKEND_DIR)/static
	cd $(FRONTEND_DIR) && npm install && npm run build

backend:
	@echo "→ Building Go backend..."
	cd $(BACKEND_DIR) && go build -o forensics .
	@echo "✓ Binary: $(BINARY)"

# ─── Run the compiled binary ──────────────────────────────────────────────────
run: build
	cd $(BACKEND_DIR) && ./forensics

# ─── Docker ──────────────────────────────────────────────────────────────────
docker:
	docker build -t blockchain-forensics .

docker-run:
	docker run -p 3400:3400 -v forensics-data:/data -e FORENSICS_DB_PATH=/data/forensics_cache.db blockchain-forensics

# ─── Clean ───────────────────────────────────────────────────────────────────
clean:
	rm -rf $(BACKEND_DIR)/static
	rm -f  $(BINARY)
	rm -rf $(FRONTEND_DIR)/node_modules/.vite
