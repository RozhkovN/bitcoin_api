package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Shared transport — connection pooling, TLS reuse across all requests
// ---------------------------------------------------------------------------

var sharedTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	MaxIdleConns:          100,
	MaxIdleConnsPerHost:   10,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
	ForceAttemptHTTP2:     false,
	TLSClientConfig: &tls.Config{
		MinVersion: tls.VersionTLS12,
	},
}

var sharedClient = &http.Client{Transport: sharedTransport}

// ---------------------------------------------------------------------------
// Core fetch primitives
// ---------------------------------------------------------------------------

// fetchJSONCtx выполняет один GET-запрос с таймаутом, без retry.
func fetchJSONCtx(ctx context.Context, rawURL string, target any, timeout time.Duration) error {
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; WalletAnalyzer/2.0; +https://localhost)")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := sharedClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

// fetchJSONRetry повторяет запрос до maxRetries раз с exponential backoff + jitter.
// 4xx-ошибки не повторяются.
func fetchJSONRetry(ctx context.Context, rawURL string, target any, timeout time.Duration, maxRetries int) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			// backoff: 600ms → 1.2s → 2.4s, ±25% jitter
			base := time.Duration(math.Pow(2, float64(attempt-1))*600) * time.Millisecond
			jitter := time.Duration(rand.Int63n(int64(base / 4)))
			wait := base + jitter
			if wait > 10*time.Second {
				wait = 10 * time.Second
			}
			log.Printf("[retry %d/%d] %s (last err: %v, wait: %v)", attempt, maxRetries, rawURL, lastErr, wait.Round(time.Millisecond))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		}

		err := fetchJSONCtx(ctx, rawURL, target, timeout)
		if err == nil {
			return nil
		}
		lastErr = err

		// Не повторяем при клиентских ошибках (400, 404, etc.)
		if strings.Contains(err.Error(), "upstream status 4") {
			return err
		}
	}
	return fmt.Errorf("all %d attempts failed: %w", maxRetries+1, lastErr)
}

// fetchJSON — обёртка для обратной совместимости (2 retry по умолчанию).
func fetchJSON(rawURL string, target any) error {
	return fetchJSONRetry(context.Background(), rawURL, target, 12*time.Second, 2)
}

// ---------------------------------------------------------------------------
// Mempool.space — BTC fallback API
// ---------------------------------------------------------------------------

const mempoolBase = "https://mempool.space"

// mempoolAddressInfo — ответ /api/address/{addr}
type mempoolAddressInfo struct {
	Address      string              `json:"address"`
	ChainStats   mempoolAddrStats    `json:"chain_stats"`
	MempoolStats mempoolAddrStats    `json:"mempool_stats"`
}

type mempoolAddrStats struct {
	FundedTxoCount int   `json:"funded_txo_count"`
	FundedTxoSum   int64 `json:"funded_txo_sum"`
	SpentTxoCount  int   `json:"spent_txo_count"`
	SpentTxoSum    int64 `json:"spent_txo_sum"`
	TxCount        int   `json:"tx_count"`
}

// mempoolTx — элемент ответа /api/address/{addr}/txs
type mempoolTx struct {
	Txid     string        `json:"txid"`
	Version  int           `json:"version"`
	Locktime int64         `json:"locktime"`
	Vin      []mempoolVin  `json:"vin"`
	Vout     []mempoolVout `json:"vout"`
	Size     int           `json:"size"`
	Weight   int           `json:"weight"`
	Fee      int64         `json:"fee"`
	Status   mempoolStatus `json:"status"`
}

type mempoolVin struct {
	Txid       string       `json:"txid"`
	Vout       int          `json:"vout"`
	Prevout    mempoolVout  `json:"prevout"`
	Sequence   int64        `json:"sequence"`
	IsCoinbase bool         `json:"is_coinbase"`
}

type mempoolVout struct {
	Scriptpubkey        string `json:"scriptpubkey"`
	ScriptpubkeyAddress string `json:"scriptpubkey_address"`
	Value               int64  `json:"value"`
}

type mempoolStatus struct {
	Confirmed   bool   `json:"confirmed"`
	BlockHeight int    `json:"block_height"`
	BlockHash   string `json:"block_hash"`
	BlockTime   int64  `json:"block_time"`
}

// fetchBtcSummaryMempool получает сводку по адресу через mempool.space.
func fetchBtcSummaryMempool(ctx context.Context, address string) (BtcSummaryResponse, error) {
	u := mempoolBase + "/api/address/" + url.PathEscape(address)
	var info mempoolAddressInfo
	if err := fetchJSONRetry(ctx, u, &info, btcSingleFetchTimeout, 2); err != nil {
		return BtcSummaryResponse{}, fmt.Errorf("mempool summary: %w", err)
	}

	balance := info.ChainStats.FundedTxoSum - info.ChainStats.SpentTxoSum +
		info.MempoolStats.FundedTxoSum - info.MempoolStats.SpentTxoSum
	ntx := info.ChainStats.TxCount + info.MempoolStats.TxCount

	return BtcSummaryResponse{
		Chain:         "bitcoin",
		Address:       address,
		NTx:           ntx,
		Balance:       roundTo(satoshiToCoin(balance), 8),
		TotalReceived: roundTo(satoshiToCoin(info.ChainStats.FundedTxoSum), 8),
		TotalSent:     roundTo(satoshiToCoin(info.ChainStats.SpentTxoSum), 8),
	}, nil
}

// paginateBtcTxsMempool постранично скачивает транзакции с mempool.space
// и возвращает их уже в формате BtcTxView (не требует дополнительной конвертации).
// Pagination у mempool.space — по txid последней транзакции.
func paginateBtcTxsMempool(ctx context.Context, address string, want int) ([]BtcTxView, error) {
	const pageSize = 25 // mempool.space отдаёт max 25 за раз
	const throttle = 60 * time.Millisecond

	var all []BtcTxView
	var lastTxID string

	for len(all) < want {
		if err := ctx.Err(); err != nil {
			return all, err
		}

		var u string
		if lastTxID == "" {
			u = mempoolBase + "/api/address/" + url.PathEscape(address) + "/txs"
		} else {
			u = mempoolBase + "/api/address/" + url.PathEscape(address) + "/txs/chain/" + lastTxID
		}

		var txs []mempoolTx
		if err := fetchJSONRetry(ctx, u, &txs, btcSingleFetchTimeout, 2); err != nil {
			return all, fmt.Errorf("mempool page (after %s): %w", lastTxID, err)
		}
		if len(txs) == 0 {
			break
		}

		for _, tx := range txs {
			view := buildBtcTxViewFromMempool(address, tx)
			if view.Direction != "" {
				all = append(all, view)
			}
			if len(all) >= want {
				return all, nil
			}
		}

		lastTxID = txs[len(txs)-1].Txid
		if len(txs) < pageSize {
			break // последняя страница
		}

		select {
		case <-ctx.Done():
			return all, ctx.Err()
		case <-time.After(throttle):
		}
	}
	return all, nil
}

// buildBtcTxViewFromMempool конвертирует mempoolTx → BtcTxView.
func buildBtcTxViewFromMempool(address string, tx mempoolTx) BtcTxView {
	var selfIn, selfOut int64
	from, to := "", ""

	inputs := make([]BtcIOView, 0, len(tx.Vin))
	for i, vin := range tx.Vin {
		addr := vin.Prevout.ScriptpubkeyAddress
		nonStd := false
		if addr == "" {
			if vin.IsCoinbase {
				addr = "(coinbase / без адреса)"
			} else {
				addr = "(без адреса)"
			}
			nonStd = true
		}
		if addr == address {
			selfOut += vin.Prevout.Value
		}
		v := satoshiToCoin(vin.Prevout.Value)
		inputs = append(inputs, BtcIOView{
			Addr:        addr,
			Value:       roundTo(v, 8),
			Index:       i,
			NonStandard: nonStd,
		})
		if i == 0 {
			from = addr
		}
	}

	outputs := make([]BtcIOView, 0, len(tx.Vout))
	for i, vout := range tx.Vout {
		addr := vout.ScriptpubkeyAddress
		nonStd := false
		if addr == "" {
			addr = "(OP_RETURN / без адреса)"
			nonStd = true
		}
		if addr == address {
			selfIn += vout.Value
		}
		v := satoshiToCoin(vout.Value)
		outputs = append(outputs, BtcIOView{
			Addr:        addr,
			Value:       roundTo(v, 8),
			Index:       i,
			NonStandard: nonStd,
		})
		if i == 0 {
			to = addr
		}
	}

	net := selfIn - selfOut
	var direction string
	if net > 0 {
		direction = "in"
	} else if net < 0 {
		direction = "out"
	}
	// net == 0 → self-transfer, direction остаётся "" → будет пропущена

	amount := satoshiToCoin(absInt64(net))

	ts := tx.Status.BlockTime
	if ts == 0 {
		ts = time.Now().Unix() // mempool (unconfirmed)
	}
	date := time.Unix(ts, 0).UTC().Format(time.RFC3339)

	status := "pending"
	if tx.Status.Confirmed {
		status = "confirmed"
	}

	return BtcTxView{
		Hash:          tx.Txid,
		ExplorerURL:   "https://mempool.space/tx/" + tx.Txid,
		Date:          date,
		Timestamp:     ts,
		Direction:     direction,
		Amount:        roundTo(amount, 8),
		Fee:           roundTo(satoshiToCoin(tx.Fee), 8),
		Status:        status,
		BlockHeight:   tx.Status.BlockHeight,
		Version:       tx.Version,
		VinSz:         len(tx.Vin),
		VoutSz:        len(tx.Vout),
		Size:          tx.Size,
		Weight:        tx.Weight,
		LockTime:      tx.Locktime,
		From:          from,
		To:            to,
		Inputs:        inputs,
		Outputs:       outputs,
		TotalInValue:  roundTo(satoshiToCoin(selfIn), 8),
		TotalOutValue: roundTo(satoshiToCoin(selfOut), 8),
	}
}
