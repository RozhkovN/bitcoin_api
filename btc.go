package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	btcPageSize           = 100
	btcMaxFetchPerRequest = 20000
	btcPageThrottle       = 100 * time.Millisecond // снижен с 130ms
	btcAnalyzeHTTPTimeout = 180 * time.Second
	btcSingleFetchTimeout = 28 * time.Second
	btcRetries            = 2 // попыток на каждый запрос
)

type btcAddrResponse struct {
	Hash160       string     `json:"hash160"`
	Address       string     `json:"address"`
	NTx           int        `json:"n_tx"`
	NUnredeemed   int        `json:"n_unredeemed"`
	TotalReceived int64      `json:"total_received"`
	TotalSent     int64      `json:"total_sent"`
	FinalBalance  int64      `json:"final_balance"`
	Txs           []btcRawTx `json:"txs"`
}

type btcRawTx struct {
	Hash        string         `json:"hash"`
	Ver         int            `json:"ver"`
	VinSz       int            `json:"vin_sz"`
	VoutSz      int            `json:"vout_sz"`
	Size        int            `json:"size"`
	Weight      int            `json:"weight"`
	LockTime    int64          `json:"lock_time"`
	RelayedBy   string         `json:"relayed_by"`
	TxIndex     int64          `json:"tx_index"`
	DoubleSpend bool           `json:"double_spend"`
	Time        int64          `json:"time"`
	Fee         int64          `json:"fee"`
	Result      int64          `json:"result"`
	Inputs      []btcRawInput  `json:"inputs"`
	Out         []btcRawOutput `json:"out"`
	BlockHeight int            `json:"block_height"`
	BlockIndex  int            `json:"block_index"`
}

type btcRawInput struct {
	PrevOut btcRawOutput `json:"prev_out"`
}

type btcRawOutput struct {
	Type  int    `json:"type"`
	Spent bool   `json:"spent"`
	Value int64  `json:"value"`
	N     int    `json:"n"`
	Addr  string `json:"addr"`
}

type BtcIOView struct {
	Addr        string  `json:"addr"`
	Value       float64 `json:"value"`
	Index       int     `json:"index"`
	Spent       bool    `json:"spent,omitempty"`
	NonStandard bool    `json:"nonStandard,omitempty"`
}

type BtcTxView struct {
	Hash          string      `json:"hash"`
	ExplorerURL   string      `json:"explorerUrl"`
	Date          string      `json:"date"`
	Timestamp     int64       `json:"timestamp"`
	Direction     string      `json:"direction"`
	Amount        float64     `json:"amount"`
	Fee           float64     `json:"fee"`
	Status        string      `json:"status"`
	BlockHeight   int         `json:"blockHeight"`
	BlockIndex    int         `json:"blockIndex"`
	Version       int         `json:"version"`
	VinSz         int         `json:"vinSz"`
	VoutSz        int         `json:"voutSz"`
	Size          int         `json:"size"`
	Weight        int         `json:"weight"`
	LockTime      int64       `json:"lockTime"`
	RelayedBy     string      `json:"relayedBy,omitempty"`
	DoubleSpend   bool        `json:"doubleSpend"`
	TxIndex       int64       `json:"txIndex"`
	From          string      `json:"from"`
	To            string      `json:"to"`
	Inputs        []BtcIOView `json:"inputs"`
	Outputs       []BtcIOView `json:"outputs"`
	TotalInValue  float64     `json:"totalInValue"`
	TotalOutValue float64     `json:"totalOutValue"`
}

type BtcSummaryResponse struct {
	Chain         string  `json:"chain"`
	Address       string  `json:"address"`
	Hash160       string  `json:"hash160,omitempty"`
	NTx           int     `json:"nTx"`
	NUnredeemed   int     `json:"nUnredeemed"`
	Balance       float64 `json:"balance"`
	TotalReceived float64 `json:"totalReceived"`
	TotalSent     float64 `json:"totalSent"`
}

type BtcAnalyzeResponse struct {
	Chain          string      `json:"chain"`
	Address        string      `json:"address"`
	Balance        float64     `json:"balance"`
	TotalOnChain   int         `json:"totalOnChain"`
	TotalReceived  float64     `json:"totalReceived"`
	TotalSent      float64     `json:"totalSent"`
	RequestedFetch int         `json:"requestedFetch"`
	Fetched        int         `json:"fetched"`
	AfterFilters   int         `json:"afterFilters"`
	TotalIn        float64     `json:"totalIn"`
	TotalOut       float64     `json:"totalOut"`
	NetFlow        float64     `json:"netFlow"`
	IncomingTx     int         `json:"incomingTx"`
	OutgoingTx     int         `json:"outgoingTx"`
	SkippedNeutral int         `json:"skippedNeutral"`
	Transactions   []BtcTxView `json:"transactions"`
	Warnings       []string    `json:"warnings,omitempty"`
}

type btcFilterParams struct {
	DateFrom  *time.Time
	DateTo    *time.Time
	MinBTC    *float64
	MaxBTC    *float64
	Direction string
}

func btcSummaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if address == "" || !btcAddressRegex.MatchString(address) {
		http.Error(w, "valid btc address required", http.StatusBadRequest)
		return
	}
	if isPresetBTC(address) {
		writeJSON(w, presetBTCSummary())
		return
	}
	s, err := fetchBtcSummary(r.Context(), address)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, s)
}

func btcAnalyzeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	address := strings.TrimSpace(q.Get("address"))
	if address == "" || !btcAddressRegex.MatchString(address) {
		http.Error(w, "valid btc address required", http.StatusBadRequest)
		return
	}

	maxFetch, err := strconv.Atoi(strings.TrimSpace(q.Get("maxTx")))
	if err != nil || maxFetch < 1 {
		maxFetch = 100
	}
	if maxFetch > btcMaxFetchPerRequest {
		maxFetch = btcMaxFetchPerRequest
	}

	filters, ferr := parseBtcFilters(q)
	if ferr != nil {
		http.Error(w, ferr.Error(), http.StatusBadRequest)
		return
	}
	if isPresetBTC(address) {
		writeJSON(w, presetBTCAnalyze(maxFetch, filters))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), btcAnalyzeHTTPTimeout)
	defer cancel()

	resp, err := analyzeBitcoinRich(ctx, address, maxFetch, filters)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, resp)
}

func parseBtcFilters(q url.Values) (*btcFilterParams, error) {
	f := &btcFilterParams{Direction: strings.ToLower(strings.TrimSpace(q.Get("direction")))}

	if f.Direction != "" && f.Direction != "in" && f.Direction != "out" {
		return nil, fmt.Errorf("direction must be in, out or empty")
	}

	if s := strings.TrimSpace(q.Get("dateFrom")); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.DateFrom = &t
		} else {
			t, err := time.Parse("2006-01-02", s)
			if err != nil {
				return nil, fmt.Errorf("dateFrom: invalid date")
			}
			start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
			f.DateFrom = &start
		}
	}
	if s := strings.TrimSpace(q.Get("dateTo")); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.DateTo = &t
		} else {
			t, err := time.Parse("2006-01-02", s)
			if err != nil {
				return nil, fmt.Errorf("dateTo: invalid date")
			}
			end := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 999_999_999, time.UTC)
			f.DateTo = &end
		}
	}

	if s := strings.TrimSpace(q.Get("minBtc")); s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < 0 {
			return nil, fmt.Errorf("minBtc invalid")
		}
		f.MinBTC = &v
	}
	if s := strings.TrimSpace(q.Get("maxBtc")); s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < 0 {
			return nil, fmt.Errorf("maxBtc invalid")
		}
		f.MaxBTC = &v
	}
	return f, nil
}

func fetchBtcSummary(ctx context.Context, address string) (BtcSummaryResponse, error) {
	// Первичный источник: blockchain.info
	u := fmt.Sprintf("https://blockchain.info/rawaddr/%s?limit=0", url.PathEscape(address))
	var raw btcAddrResponse
	if err := fetchJSONRetry(ctx, u, &raw, btcSingleFetchTimeout, btcRetries); err == nil {
		return BtcSummaryResponse{
			Chain:         "bitcoin",
			Address:       raw.Address,
			Hash160:       raw.Hash160,
			NTx:           raw.NTx,
			NUnredeemed:   raw.NUnredeemed,
			Balance:       roundTo(satoshiToCoin(raw.FinalBalance), 8),
			TotalReceived: roundTo(satoshiToCoin(raw.TotalReceived), 8),
			TotalSent:     roundTo(satoshiToCoin(raw.TotalSent), 8),
		}, nil
	}

	// Fallback: mempool.space
	log.Printf("[btc] blockchain.info summary недоступен, переключаюсь на mempool.space")
	return fetchBtcSummaryMempool(ctx, address)
}

func analyzeBitcoinRich(ctx context.Context, address string, maxFetch int, filters *btcFilterParams) (BtcAnalyzeResponse, error) {
	meta, err := fetchBtcSummary(ctx, address)
	if err != nil {
		return BtcAnalyzeResponse{}, err
	}

	want := maxFetch
	if meta.NTx > 0 && want > meta.NTx {
		want = meta.NTx
	}

	var warnings []string
	if maxFetch > meta.NTx && meta.NTx > 0 {
		warnings = append(warnings, fmt.Sprintf("запрошено %d, в сети у адреса %d транзакций", maxFetch, meta.NTx))
	}

	allViews, source, err := fetchBtcTxViews(ctx, address, want)
	if err != nil {
		return BtcAnalyzeResponse{}, err
	}
	if source != "blockchain.info" {
		warnings = append(warnings, fmt.Sprintf("данные транзакций получены через %s (основной API недоступен)", source))
	}

	var (
		out      []BtcTxView
		skipped  int
		totalIn  float64
		totalOut float64
		inCount  int
		outCount int
	)
	for _, view := range allViews {
		if view.Direction == "" {
			skipped++
			continue
		}
		if !btcTxMatchesFilters(view, filters) {
			continue
		}
		out = append(out, view)
		switch view.Direction {
		case "in":
			totalIn += view.Amount
			inCount++
		case "out":
			totalOut += view.Amount
			outCount++
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp > out[j].Timestamp
	})

	resp := BtcAnalyzeResponse{
		Chain:          "bitcoin",
		Address:        address,
		Balance:        meta.Balance,
		TotalOnChain:   meta.NTx,
		TotalReceived:  meta.TotalReceived,
		TotalSent:      meta.TotalSent,
		RequestedFetch: maxFetch,
		Fetched:        len(allViews),
		AfterFilters:   len(out),
		TotalIn:        roundTo(totalIn, 8),
		TotalOut:       roundTo(totalOut, 8),
		NetFlow:        roundTo(totalIn-totalOut, 8),
		IncomingTx:     inCount,
		OutgoingTx:     outCount,
		SkippedNeutral: skipped,
		Transactions:   out,
		Warnings:       warnings,
	}
	return resp, nil
}

func paginateBtcTxs(ctx context.Context, address string, want int) ([]btcRawTx, error) {
	var all []btcRawTx
	offset := 0
	for len(all) < want {
		if err := ctx.Err(); err != nil {
			return all, err
		}
		pageURL := fmt.Sprintf(
			"https://blockchain.info/rawaddr/%s?limit=%d&offset=%d",
			url.PathEscape(address), btcPageSize, offset,
		)
		var page btcAddrResponse
		if err := fetchJSONRetry(ctx, pageURL, &page, btcSingleFetchTimeout, btcRetries); err != nil {
			return all, fmt.Errorf("btc page offset %d: %w", offset, err)
		}
		if len(page.Txs) == 0 {
			break
		}
		for _, tx := range page.Txs {
			all = append(all, tx)
			if len(all) >= want {
				break
			}
		}
		offset += len(page.Txs)
		if len(page.Txs) < btcPageSize {
			break
		}
		select {
		case <-ctx.Done():
			return all, ctx.Err()
		case <-time.After(btcPageThrottle):
		}
	}
	return all, nil
}

// fetchBtcTxViews получает транзакции через relay-цепочку источников.
// При падении очередного источника передаёт cursor следующему — без потери порядка.
func fetchBtcTxViews(ctx context.Context, address string, want int) ([]BtcTxView, string, error) {
	views, err := fetchBtcTxViewsRelay(ctx, address, want)
	return views, "relay", err
}

func buildBtcTxView(address string, tx btcRawTx) BtcTxView {
	inputs := make([]BtcIOView, 0, len(tx.Inputs))
	var totalIn float64
	for i, in := range tx.Inputs {
		po := in.PrevOut
		addr := strings.TrimSpace(po.Addr)
		nonStd := false
		if addr == "" {
			addr = "(coinbase / без адреса)"
			nonStd = true
		}
		v := satoshiToCoin(po.Value)
		totalIn += v
		inputs = append(inputs, BtcIOView{
			Addr:        addr,
			Value:       roundTo(v, 8),
			Index:       i,
			Spent:       po.Spent,
			NonStandard: nonStd,
		})
	}

	outputs := make([]BtcIOView, 0, len(tx.Out))
	var totalOut float64
	for _, o := range tx.Out {
		addr := strings.TrimSpace(o.Addr)
		nonStd := false
		if addr == "" {
			addr = "(OP_RETURN / без адреса)"
			nonStd = true
		}
		v := satoshiToCoin(o.Value)
		totalOut += v
		outputs = append(outputs, BtcIOView{
			Addr:        addr,
			Value:       roundTo(v, 8),
			Index:       o.N,
			Spent:       o.Spent,
			NonStandard: nonStd,
		})
	}

	from := ""
	to := ""
	if len(inputs) > 0 {
		from = inputs[0].Addr
	}
	if len(outputs) > 0 {
		to = outputs[0].Addr
	}

	var direction string
	amount := satoshiToCoin(absInt64(tx.Result))
	if tx.Result < 0 {
		direction = "out"
	} else if tx.Result > 0 {
		direction = "in"
	}

	date := time.Unix(tx.Time, 0).UTC().Format(time.RFC3339)

	return BtcTxView{
		Hash:          tx.Hash,
		ExplorerURL:   "https://mempool.space/tx/" + tx.Hash,
		Date:          date,
		Timestamp:     tx.Time,
		Direction:     direction,
		Amount:        roundTo(amount, 8),
		Fee:           roundTo(satoshiToCoin(tx.Fee), 8),
		Status:        statusByConfirmations(tx.BlockHeight),
		BlockHeight:   tx.BlockHeight,
		BlockIndex:    tx.BlockIndex,
		Version:       tx.Ver,
		VinSz:         tx.VinSz,
		VoutSz:        tx.VoutSz,
		Size:          tx.Size,
		Weight:        tx.Weight,
		LockTime:      tx.LockTime,
		RelayedBy:     tx.RelayedBy,
		DoubleSpend:   tx.DoubleSpend,
		TxIndex:       tx.TxIndex,
		From:          from,
		To:            to,
		Inputs:        inputs,
		Outputs:       outputs,
		TotalInValue:  roundTo(totalIn, 8),
		TotalOutValue: roundTo(totalOut, 8),
	}
}

func btcTxMatchesFilters(v BtcTxView, f *btcFilterParams) bool {
	if f == nil {
		return true
	}
	if f.Direction != "" && v.Direction != f.Direction {
		return false
	}
	ts := time.Unix(v.Timestamp, 0).UTC()
	if f.DateFrom != nil && ts.Before(*f.DateFrom) {
		return false
	}
	if f.DateTo != nil && ts.After(*f.DateTo) {
		return false
	}
	amt := v.Amount
	if f.MinBTC != nil && amt < *f.MinBTC {
		return false
	}
	if f.MaxBTC != nil && amt > *f.MaxBTC {
		return false
	}
	return true
}

func analyzeBitcoinLegacy(address string) (AnalyzeResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	meta, err := fetchBtcSummary(ctx, address)
	if err != nil {
		return AnalyzeResponse{}, err
	}

	views, _, err := fetchBtcTxViews(ctx, address, 50)
	if err != nil {
		return AnalyzeResponse{}, err
	}

	view := AnalyzeResponse{
		Chain:        "bitcoin",
		Address:      address,
		Balance:      meta.Balance,
		TotalTx:      meta.NTx,
		Transactions: make([]TxView, 0, len(views)),
	}

	var totalIn, totalOut float64
	for _, b := range views {
		if b.Direction == "" {
			continue
		}
		switch b.Direction {
		case "out":
			totalOut += b.Amount
			view.OutgoingTx++
		case "in":
			totalIn += b.Amount
			view.IncomingTx++
		}
		view.Transactions = append(view.Transactions, TxView{
			Hash:      b.Hash,
			Date:      b.Date,
			Direction: b.Direction,
			Amount:    b.Amount,
			From:      b.From,
			To:        b.To,
			Fee:       b.Fee,
			Status:    b.Status,
		})
	}

	sort.Slice(view.Transactions, func(i, j int) bool {
		return view.Transactions[i].Date > view.Transactions[j].Date
	})
	view.TotalIn = roundTo(totalIn, 8)
	view.TotalOut = roundTo(totalOut, 8)
	view.NetFlow = roundTo(totalIn-totalOut, 8)
	return view, nil
}
