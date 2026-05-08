package main

// ─────────────────────────────────────────────────────────────────────────────
//  BTC Relay Paginator
//
//  Проблема: ни один источник не гарантирует выдачу всех транзакций за один
//  прогон. blockchain.info часто отвечает 429, mempool.space отдаёт 25 tx/стр
//  и тоже может лимитировать. blockstream.info — независимый бэкенд.
//
//  Решение: "relay" — цепочка источников с передачей курсора.
//
//  Порядок:
//    1. blockchain.info  (offset-based, 100/стр)
//    2. mempool.space    (esplora cursor-based, 25/стр)
//    3. blockstream.info (esplora cursor-based, 25/стр)
//    4. mempool.emzy.de  (community mirror, 25/стр)
//
//  Курсор = txid последней полученной транзакции (не фильтрованной).
//  Esplora: GET /api/address/{addr}/txs/chain/{cursor}
//           → возвращает подтверждённые tx СТАРШЕ {cursor}.
//  Если источник упал после N транзакций — следующий источник получает
//  cursor = txid(N-й tx) и продолжает с нужного места.
//  blockchain.info не поддерживает cursor → пропускается, если cursor != "".
// ─────────────────────────────────────────────────────────────────────────────

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"time"
)

// btcRelaySource описывает один источник транзакций.
// afterTxid — пустой при старте, иначе txid последней tx из предыдущего источника.
// Возвращает: []BtcTxView (включая neutral), lastRawTxid (курсор для следующего), ошибку.
type btcRelaySource struct {
	Name  string
	Fetch func(ctx context.Context, addr string, want int, afterTxid string) ([]BtcTxView, string, error)
}

var btcRelaySources = []btcRelaySource{
	{Name: "blockchain.info", Fetch: relayBlockchainInfo},
	{Name: "mempool.space", Fetch: relayEsplora("https://mempool.space")},
	{Name: "blockstream.info", Fetch: relayEsplora("https://blockstream.info")},
	{Name: "mempool.emzy.de", Fetch: relayEsplora("https://mempool.emzy.de")},
}

// fetchBtcTxViewsRelay — главная точка входа.
// Возвращает до `want` транзакций, используя источники как цепочку.
// При падении источника N-й tx → передаёт cursor следующему источнику.
func fetchBtcTxViewsRelay(ctx context.Context, addr string, want int) ([]BtcTxView, error) {
	var all []BtcTxView
	var cursor string // txid последней полученной tx (любой источник)

	for _, src := range btcRelaySources {
		if len(all) >= want || ctx.Err() != nil {
			break
		}
		remaining := want - len(all)

		log.Printf("[relay] %s: запрашиваю %d tx (имею %d/%d, cursor=%s)",
			src.Name, remaining, len(all), want, shortTxid(cursor))

		batch, newCursor, err := src.Fetch(ctx, addr, remaining, cursor)

		if len(batch) > 0 {
			all = append(all, batch...)
			if newCursor != "" {
				cursor = newCursor
			}
			log.Printf("[relay] %s: получено %d tx (итого %d/%d, cursor→%s)",
				src.Name, len(batch), len(all), want, shortTxid(cursor))
		}

		if err != nil {
			log.Printf("[relay] %s: ошибка после %d tx: %v → следующий источник",
				src.Name, len(batch), err)
			continue // следующий источник с тем же cursor
		}

		if len(all) >= want {
			break // получили всё что нужно
		}

		if len(batch) < remaining {
			// Источник исчерпан (транзакций в сети больше нет)
			log.Printf("[relay] %s: исчерпан (%d tx в сети)", src.Name, len(all))
			break
		}
	}

	if len(all) == 0 {
		return nil, fmt.Errorf("все BTC-источники недоступны или не вернули транзакций")
	}
	return all, nil
}

// ─── blockchain.info (offset-based) ──────────────────────────────────────────

func relayBlockchainInfo(ctx context.Context, addr string, want int, afterTxid string) ([]BtcTxView, string, error) {
	if afterTxid != "" {
		// blockchain.info не поддерживает cursor-based пагинацию → пропускаем.
		return nil, afterTxid, fmt.Errorf("blockchain.info: нет поддержки cursor-пагинации (afterTxid=%s)", shortTxid(afterTxid))
	}

	const pageSize = 100
	var all []BtcTxView
	offset := 0

	for len(all) < want {
		if ctx.Err() != nil {
			return all, lastTxHash(all), ctx.Err()
		}
		lim := pageSize
		if want-len(all) < lim {
			lim = want - len(all)
		}
		u := fmt.Sprintf(
			"https://blockchain.info/rawaddr/%s?limit=%d&offset=%d",
			url.PathEscape(addr), lim, offset,
		)
		var page btcAddrResponse
		if err := fetchJSONRetry(ctx, u, &page, btcSingleFetchTimeout, 1); err != nil {
			return all, lastTxHash(all), fmt.Errorf("offset %d: %w", offset, err)
		}
		if len(page.Txs) == 0 {
			break
		}
		for _, tx := range page.Txs {
			all = append(all, buildBtcTxView(addr, tx))
			if len(all) >= want {
				break
			}
		}
		offset += len(page.Txs)
		if len(page.Txs) < lim {
			break
		}
		select {
		case <-ctx.Done():
			return all, lastTxHash(all), ctx.Err()
		case <-time.After(btcPageThrottle):
		}
	}
	return all, lastTxHash(all), nil
}

// ─── Esplora (mempool.space, blockstream.info и совместимые) ─────────────────

// relayEsplora возвращает функцию-источник для любого esplora-совместимого API.
// afterTxid — txid последней TX из предыдущего источника.
// /api/address/{addr}/txs/chain/{afterTxid} → tx СТАРШЕ afterTxid, страница 25 штук.
func relayEsplora(base string) func(ctx context.Context, addr string, want int, afterTxid string) ([]BtcTxView, string, error) {
	return func(ctx context.Context, addr string, want int, afterTxid string) ([]BtcTxView, string, error) {
		const pageSize = 25
		const throttle = 80 * time.Millisecond

		var all []BtcTxView
		// apiCursor — txid, передаваемый в URL (/txs/chain/{apiCursor}).
		// Сначала используем afterTxid (курсор от предыдущего источника),
		// потом обновляем на последний raw txid каждой страницы.
		apiCursor := afterTxid
		var lastRawTxid string

		for len(all) < want {
			if ctx.Err() != nil {
				return all, orStr(lastRawTxid, apiCursor), ctx.Err()
			}

			var u string
			if apiCursor == "" {
				u = base + "/api/address/" + url.PathEscape(addr) + "/txs"
			} else {
				u = base + "/api/address/" + url.PathEscape(addr) + "/txs/chain/" + apiCursor
			}

			var txs []mempoolTx
			if err := fetchJSONRetry(ctx, u, &txs, btcSingleFetchTimeout, 2); err != nil {
				return all, orStr(lastRawTxid, apiCursor), fmt.Errorf("%s cursor=%s: %w", base, shortTxid(apiCursor), err)
			}
			if len(txs) == 0 {
				break
			}

			for _, tx := range txs {
				lastRawTxid = tx.Txid
				// Включаем все tx (в т.ч. neutral direction=""), фильтрация выше по стеку.
				all = append(all, buildBtcTxViewFromMempool(addr, tx))
				if len(all) >= want {
					return all, lastRawTxid, nil
				}
			}

			// Cursor для следующей страницы = txid последнего raw tx на этой.
			apiCursor = txs[len(txs)-1].Txid
			lastRawTxid = apiCursor

			if len(txs) < pageSize {
				break // последняя страница, источник исчерпан
			}

			select {
			case <-ctx.Done():
				return all, lastRawTxid, ctx.Err()
			case <-time.After(throttle):
			}
		}

		return all, orStr(lastRawTxid, apiCursor), nil
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// lastTxHash возвращает Hash последнего элемента среза или "".
func lastTxHash(views []BtcTxView) string {
	if len(views) == 0 {
		return ""
	}
	return views[len(views)-1].Hash
}

// orStr возвращает a, если непустой, иначе b.
func orStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// shortTxid обрезает txid для читаемых логов.
func shortTxid(s string) string {
	if s == "" {
		return "start"
	}
	if len(s) > 12 {
		return s[:8] + "…"
	}
	return s
}
