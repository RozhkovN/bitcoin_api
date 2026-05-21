package main

// ─────────────────────────────────────────────────────────────────────────────
//  BTC TX Cache  (SQLite-based)
//
//  Стратегия:
//    1. Forward sync  — при повторном запросе тянем последнюю страницу API
//       и останавливаемся, как только встречаем уже известный txid.
//       Так подхватываются новые входящие TX без полного сброса кэша.
//
//    2. Backward sync — если в кэше меньше TX, чем нужно, берём cursor =
//       txid самой старой закэшированной TX и продолжаем через relay
//       (fetchBtcTxViewsRelay). Relay гарантирует порядок и отсутствие дублей.
//
//    3. INSERT OR IGNORE по PRIMARY KEY (txid, address, chain) —
//       полная защита от дублей даже при параллельных запросах.
//
//  Оффлайн: если все API недоступны, возвращаем то что есть в кэше.
// ─────────────────────────────────────────────────────────────────────────────

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sync"
	"time"
)

// ─── Summary cache ────────────────────────────────────────────────────────────

// summaryCacheGet возвращает закэшированный JSON summary.
// Без TTL: если данные есть — отдаём сразу; актуальность обеспечивает фоновое обновление.
func summaryCacheGet(address, chain string) ([]byte, bool) {
	var payload string
	err := globalDB.QueryRow(
		`SELECT payload FROM summary_cache WHERE address=? AND chain=?`,
		address, chain,
	).Scan(&payload)
	if err != nil || payload == "" {
		return nil, false
	}
	return []byte(payload), true
}

// ─── Async summary refresh ────────────────────────────────────────────────────

var summaryRefreshActive sync.Map

// asyncSummaryRefresh обновляет кэш summary в фоне (одна горутина на адрес).
// fn должна вернуть свежий JSON payload или ошибку.
func asyncSummaryRefresh(address, chain string, fn func() ([]byte, error)) {
	key := "summary:" + address + ":" + chain
	if _, loaded := summaryRefreshActive.LoadOrStore(key, struct{}{}); loaded {
		return // уже обновляется
	}
	go func() {
		defer summaryRefreshActive.Delete(key)
		data, err := fn()
		if err != nil {
			log.Printf("[cache] bg summary refresh error (%s/%s): %v", chain, shortTxid(address), err)
			return
		}
		if len(data) > 0 {
			summaryCacheSet(address, chain, data)
			log.Printf("[cache] bg summary refreshed: %s/%s", chain, shortTxid(address))
		}
	}()
}

// summaryCacheSet сохраняет (или обновляет) JSON summary в кэш.
func summaryCacheSet(address, chain string, data []byte) {
	if len(data) == 0 {
		return
	}
	globalDB.Exec(`
		INSERT INTO summary_cache(address, chain, payload, cached_at)
		VALUES(?,?,?,?)
		ON CONFLICT(address, chain) DO UPDATE SET payload=excluded.payload, cached_at=excluded.cached_at`,
		address, chain, string(data), time.Now().Unix(),
	)
}

// ─── Async forward sync ───────────────────────────────────────────────────────

// fwdSyncActive предотвращает параллельный запуск нескольких горутин
// forward-sync для одного и того же адреса.
var fwdSyncActive sync.Map

// asyncForwardSync запускает cacheForwardSync в фоне и немедленно возвращает.
// Если горутина для этого адреса уже запущена — новую не создаёт.
func asyncForwardSync(address, chain string) {
	key := address + ":" + chain
	if _, loaded := fwdSyncActive.LoadOrStore(key, struct{}{}); loaded {
		return // уже синхронизируется
	}
	go func() {
		defer fwdSyncActive.Delete(key)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		added := cacheForwardSync(ctx, address, chain)
		if added > 0 {
			log.Printf("[cache] bg forward-sync: +%d TX for %s", added, shortTxid(address))
		}
	}()
}

// ─── Чтение ──────────────────────────────────────────────────────────────────

// cacheCountTx возвращает количество направленных (in/out) TX для адреса.
// Нейтральные TX (direction='') хранятся для курсора, но не считаются.
func cacheCountTx(address, chain string) int {
	var n int
	globalDB.QueryRow(
		`SELECT COUNT(*) FROM wallet_tx WHERE address=? AND chain=? AND direction != ''`,
		address, chain,
	).Scan(&n)
	return n
}

// cacheTotalCount — общее число TX в кэше включая нейтральные (для курсора).
func cacheTotalCount(address, chain string) int {
	var n int
	globalDB.QueryRow(
		`SELECT COUNT(*) FROM wallet_tx WHERE address=? AND chain=?`,
		address, chain,
	).Scan(&n)
	return n
}

// cacheGetTxViews возвращает до want TX из кэша, сортировка: новейшие первыми.
func cacheGetTxViews(address, chain string, want int) []BtcTxView {
	rows, err := globalDB.Query(`
		SELECT txid, direction, amount, fee, timestamp, block_height, status,
		       from_addr, to_addr, explorer_url,
		       vin_sz, vout_sz, size, weight, version, locktime,
		       total_in, total_out,
		       COALESCE(inputs_json,'[]'), COALESCE(outputs_json,'[]')
		FROM wallet_tx
		WHERE address=? AND chain=? AND direction != ''
		ORDER BY timestamp DESC, block_height DESC
		LIMIT ?`,
		address, chain, want,
	)
	if err != nil {
		log.Printf("[cache] read error: %v", err)
		return nil
	}
	defer rows.Close()

	var out []BtcTxView
	for rows.Next() {
		var v BtcTxView
		var inputsJSON, outputsJSON string
		if err := rows.Scan(
			&v.Hash, &v.Direction, &v.Amount, &v.Fee,
			&v.Timestamp, &v.BlockHeight, &v.Status,
			&v.From, &v.To, &v.ExplorerURL,
			&v.VinSz, &v.VoutSz, &v.Size, &v.Weight, &v.Version, &v.LockTime,
			&v.TotalInValue, &v.TotalOutValue,
			&inputsJSON, &outputsJSON,
		); err != nil {
			continue
		}
		if v.Timestamp > 0 {
			v.Date = time.Unix(v.Timestamp, 0).UTC().Format(time.RFC3339)
		}
		json.Unmarshal([]byte(inputsJSON), &v.Inputs)   //nolint
		json.Unmarshal([]byte(outputsJSON), &v.Outputs) //nolint
		out = append(out, v)
	}
	return out
}

// cacheNewestTxid — txid самой свежей TX (для forward-sync).
func cacheNewestTxid(address, chain string) string {
	var txid string
	globalDB.QueryRow(`
		SELECT txid FROM wallet_tx WHERE address=? AND chain=?
		ORDER BY timestamp DESC, block_height DESC LIMIT 1`,
		address, chain,
	).Scan(&txid)
	return txid
}

// cacheOldestTxid — txid самой старой TX (cursor для backward-sync).
func cacheOldestTxid(address, chain string) string {
	var txid string
	globalDB.QueryRow(`
		SELECT txid FROM wallet_tx WHERE address=? AND chain=?
		ORDER BY timestamp ASC, block_height ASC LIMIT 1`,
		address, chain,
	).Scan(&txid)
	return txid
}

// ─── Запись ──────────────────────────────────────────────────────────────────

// cacheStoreTxViews сохраняет срез TX в БД. Дубли игнорируются (INSERT OR IGNORE).
func cacheStoreTxViews(address, chain string, views []BtcTxView) int {
	if len(views) == 0 {
		return 0
	}
	tx, err := globalDB.Begin()
	if err != nil {
		log.Printf("[cache] begin error: %v", err)
		return 0
	}
	defer tx.Rollback() //nolint

	stmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO wallet_tx
		(txid, address, chain, direction, amount, fee, timestamp, block_height,
		 status, from_addr, to_addr, explorer_url,
		 vin_sz, vout_sz, size, weight, version, locktime, total_in, total_out,
		 inputs_json, outputs_json)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return 0
	}
	defer stmt.Close()

	inserted := 0
	for _, v := range views {
		if v.Hash == "" {
			continue
		}
		inputsJSON, _ := json.Marshal(v.Inputs)
		outputsJSON, _ := json.Marshal(v.Outputs)
		res, err := stmt.Exec(
			v.Hash, address, chain, v.Direction, v.Amount, v.Fee,
			v.Timestamp, v.BlockHeight, v.Status, v.From, v.To, v.ExplorerURL,
			v.VinSz, v.VoutSz, v.Size, v.Weight, v.Version, v.LockTime,
			v.TotalInValue, v.TotalOutValue,
			string(inputsJSON), string(outputsJSON),
		)
		if err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				inserted++
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0
	}

	// Обновляем метку синхронизации
	globalDB.Exec(`
		INSERT INTO wallet_summary(address, chain, last_synced)
		VALUES(?,?,?)
		ON CONFLICT(address, chain) DO UPDATE SET last_synced=excluded.last_synced`,
		address, chain, time.Now().Unix(),
	)

	log.Printf("[cache] stored %d new TX for %s/%s (of %d attempted)",
		inserted, chain, shortTxid(address), len(views))
	return inserted
}

// ─── Forward sync ─────────────────────────────────────────────────────────────

// cacheForwardSync тянет последнюю страницу API (без cursor) и останавливается
// при первом уже известном txid. Возвращает число добавленных TX.
func cacheForwardSync(ctx context.Context, address, chain string) int {
	newestKnown := cacheNewestTxid(address, chain)
	if newestKnown == "" {
		return 0 // нечего сравнивать — нет кэша вообще
	}

	u := fmt.Sprintf("https://mempool.space/api/address/%s/txs",
		url.PathEscape(address))
	var txs []mempoolTx
	if err := fetchJSONRetry(ctx, u, &txs, btcSingleFetchTimeout, 1); err != nil {
		log.Printf("[cache] forward sync error: %v", err)
		return 0
	}

	var newViews []BtcTxView
	for _, tx := range txs {
		if tx.Txid == newestKnown {
			break // достигли известного — дальше всё уже в кэше
		}
		newViews = append(newViews, buildBtcTxViewFromMempool(address, tx))
	}
	return cacheStoreTxViews(address, chain, newViews)
}

// ─── Главная точка входа ─────────────────────────────────────────────────────

// fetchBtcTxViewsCached — умный fetch с кэшем:
//  1. Forward sync (проверяем новые TX)
//  2. Если в кэше достаточно — возвращаем из кэша
//  3. Backward sync через relay (cursor = oldest txid из кэша)
//  4. Оффлайн-режим: если API упал — отдаём то что есть в кэше
func fetchBtcTxViewsCached(ctx context.Context, address string, want int) ([]BtcTxView, error) {
	const chain = "bitcoin"

	cachedCount := cacheCountTx(address, chain)
	log.Printf("[cache] %s: %d cached, want %d", shortTxid(address), cachedCount, want)

	// ── 1. Forward sync ASYNC: не блокируем ответ, подхватываем новые TX в фоне ──
	if cachedCount > 0 {
		asyncForwardSync(address, chain)
	}

	// ── 2. Достаточно в кэше? Отдаём сразу ──
	if cachedCount >= want {
		log.Printf("[cache] %s: serving %d TX from cache (bg sync launched)", shortTxid(address), want)
		return cacheGetTxViews(address, chain, want), nil
	}

	// ── 3. Backward sync: добираем через relay ──
	remaining := want - cachedCount
	cursor := cacheOldestTxid(address, chain) // пустая строка = с самого начала
	log.Printf("[cache] %s: backward sync %d TX (cursor=%s)",
		shortTxid(address), remaining, shortTxid(cursor))

	newViews, err := fetchBtcTxViewsRelay(ctx, address, remaining, cursor)
	if len(newViews) > 0 {
		cacheStoreTxViews(address, chain, newViews)
	}

	// ── 4. Собираем финальный результат из кэша ──
	result := cacheGetTxViews(address, chain, want)
	if len(result) == 0 && err != nil {
		return nil, fmt.Errorf("кэш пуст и API недоступен: %w", err)
	}
	if err != nil {
		log.Printf("[cache] backward sync partial error: %v (have %d TX)", err, len(result))
	}
	return result, nil
}
