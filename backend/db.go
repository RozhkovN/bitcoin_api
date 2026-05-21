package main

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var globalDB *sql.DB

// initDB открывает (или создаёт) SQLite-кэш.
// Приоритет пути: FORENSICS_DB_PATH env → рядом с бинарником (если не build-cache) → текущая директория.
func initDB() {
	var dbPath string
	if env := os.Getenv("FORENSICS_DB_PATH"); env != "" {
		dbPath = env
	} else {
		dir := resolveDBDir()
		dbPath = filepath.Join(dir, "forensics_cache.db")
	}

	// Ensure parent directory exists (important for containers/custom paths).
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatalf("[db] mkdir error for %s: %v", dbPath, err)
	}

	db, err := sql.Open("sqlite", dbPath+"?_journal=WAL&_synchronous=NORMAL&_cache_size=-65536&_temp_store=MEMORY")
	if err != nil {
		log.Fatalf("[db] open error: %v", err)
	}
	db.SetMaxOpenConns(1) // SQLite лучше работает с одним writer
	if err := dbMigrate(db); err != nil {
		log.Fatalf("[db] migrate error: %v", err)
	}
	globalDB = db
	log.Printf("[db] SQLite cache: %s", dbPath)
}

// resolveDBDir возвращает директорию для хранения forensics_cache.db.
// При `go run` os.Executable() указывает на временный файл в go-build кэше —
// в этом случае падаем обратно в os.Getwd().
func resolveDBDir() string {
	exe, err := os.Executable()
	if err != nil {
		return mustGetwd()
	}
	// Признаки go-build кэша / temp-директории
	dir := filepath.Dir(exe)
	for _, bad := range []string{"go-build", "T/", "/tmp/", "\\Temp\\"} {
		if len(dir) > len(bad) && (contains(dir, bad)) {
			return mustGetwd()
		}
	}
	return dir
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsStr(s, sub))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func dbMigrate(db *sql.DB) error {
	_, err := db.Exec(`
	-- Сводка по кошельку
	CREATE TABLE IF NOT EXISTS wallet_summary (
		address      TEXT NOT NULL,
		chain        TEXT NOT NULL,
		n_tx_total   INTEGER DEFAULT 0,
		last_synced  INTEGER DEFAULT 0,
		PRIMARY KEY (address, chain)
	);

	-- Транзакции кошелька (включая JSON-массивы входов/выходов)
	CREATE TABLE IF NOT EXISTS wallet_tx (
		txid         TEXT NOT NULL,
		address      TEXT NOT NULL,
		chain        TEXT NOT NULL,
		direction    TEXT    DEFAULT '',
		amount       REAL    DEFAULT 0,
		fee          REAL    DEFAULT 0,
		timestamp    INTEGER DEFAULT 0,
		block_height INTEGER DEFAULT 0,
		status       TEXT    DEFAULT 'confirmed',
		from_addr    TEXT    DEFAULT '',
		to_addr      TEXT    DEFAULT '',
		explorer_url TEXT    DEFAULT '',
		vin_sz       INTEGER DEFAULT 0,
		vout_sz      INTEGER DEFAULT 0,
		size         INTEGER DEFAULT 0,
		weight       INTEGER DEFAULT 0,
		version      INTEGER DEFAULT 0,
		locktime     INTEGER DEFAULT 0,
		total_in     REAL    DEFAULT 0,
		total_out    REAL    DEFAULT 0,
		inputs_json  TEXT    DEFAULT '[]',
		outputs_json TEXT    DEFAULT '[]',
		PRIMARY KEY (txid, address, chain)
	);

	CREATE INDEX IF NOT EXISTS idx_wtx_addr_ts
		ON wallet_tx(address, chain, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_wtx_addr_bh
		ON wallet_tx(address, chain, block_height DESC);

	-- Кэш summary (balance, nTx и т.д.) — TTL 5 минут
	CREATE TABLE IF NOT EXISTS summary_cache (
		address   TEXT NOT NULL,
		chain     TEXT NOT NULL,
		payload   TEXT NOT NULL,
		cached_at INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (address, chain)
	);

	-- Кэш результатов Trace (по txid/depth/direction)
	CREATE TABLE IF NOT EXISTS trace_cache (
		cache_key    TEXT PRIMARY KEY,
		chain        TEXT    NOT NULL,
		root_hash    TEXT    NOT NULL,
		depth        INTEGER NOT NULL,
		direction    TEXT    NOT NULL,
		payload_json TEXT    NOT NULL,
		created_at   INTEGER NOT NULL,
		last_hit     INTEGER NOT NULL DEFAULT 0,
		hits         INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_trace_cache_lookup
		ON trace_cache(chain, root_hash, depth, direction);
	`)
	if err != nil {
		return err
	}
	// Миграция для существующих БД — добавляем колонки если их нет
	for _, col := range []string{
		"ALTER TABLE wallet_tx ADD COLUMN inputs_json  TEXT DEFAULT '[]'",
		"ALTER TABLE wallet_tx ADD COLUMN outputs_json TEXT DEFAULT '[]'",
	} {
		db.Exec(col) // ошибки игнорируем (колонка уже может существовать)
	}
	return nil
}
