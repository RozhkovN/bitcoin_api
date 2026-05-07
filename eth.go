package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	ethBlockscoutAPI      = "https://eth.blockscout.com/api"
	ethBlockscoutV2       = "https://eth.blockscout.com/api/v2"
	ethExplorerBase       = "https://ethscan.org"
	ethPageSize           = 100
	ethMaxFetchPerRequest = 20000
	ethPageThrottle       = 220 * time.Millisecond
	ethAnalyzeHTTPTimeout = 180 * time.Second
	ethSingleFetchTimeout = 30 * time.Second
	ethPublicRPC          = "https://ethereum.publicnode.com"
	ethSummaryTotalsMaxTx = 2000
	ethReceiptBatchSize   = 80
)

type EthSummaryResponse struct {
	Chain         string  `json:"chain"`
	Address       string  `json:"address"`
	NTx           int     `json:"nTx"`
	Balance       float64 `json:"balance"`
	TotalReceived float64 `json:"totalReceived"`
	TotalSent     float64 `json:"totalSent"`
	NUnredeemed   int     `json:"nUnredeemed"`
}

type ethV2Counters struct {
	TransactionsCount string `json:"transactions_count"`
}

type ethBalanceResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Result  string `json:"result"`
}

type ethTxlistResponse struct {
	Status  string     `json:"status"`
	Message string     `json:"message"`
	Result  []ethRawTx `json:"result"`
}

type ethInternalListResponse struct {
	Status  string           `json:"status"`
	Message string           `json:"message"`
	Result  []ethInternalRaw `json:"result"`
}

type ethRawTx struct {
	BlockNumber       string `json:"blockNumber"`
	BlockHash         string `json:"blockHash"`
	TimeStamp         string `json:"timeStamp"`
	Hash              string `json:"hash"`
	Nonce             string `json:"nonce"`
	TransactionIndex  string `json:"transactionIndex"`
	From              string `json:"from"`
	To                string `json:"to"`
	Value             string `json:"value"`
	Gas               string `json:"gas"`
	GasPrice          string `json:"gasPrice"`
	GasUsed           string `json:"gasUsed"`
	EffectiveGasPrice string `json:"effectiveGasPrice"`
	Input             string `json:"input"`
	MethodID          string `json:"methodId"`
	FunctionName      string `json:"functionName"`
	ContractAddress   string `json:"contractAddress"`
	CumulativeGasUsed string `json:"cumulativeGasUsed"`
	TxReceiptStatus   string `json:"txreceipt_status"`
	IsError           string `json:"isError"`
	Confirmations     string `json:"confirmations"`
}

type ethInternalRaw struct {
	BlockNumber     string `json:"blockNumber"`
	TimeStamp       string `json:"timeStamp"`
	Hash            string `json:"hash"`
	From            string `json:"from"`
	To              string `json:"to"`
	Value           string `json:"value"`
	ContractAddress string `json:"contractAddress"`
	Input           string `json:"input"`
	Type            string `json:"type"`
	Gas             string `json:"gas"`
	GasUsed         string `json:"gasUsed"`
	TraceID         string `json:"traceId"`
	IsError         string `json:"isError"`
	ErrCode         string `json:"errCode"`
	TransactionHash string `json:"transactionHash"`
}

type EthTxView struct {
	Kind              string  `json:"kind"`
	Hash              string  `json:"hash"`
	ParentHash        string  `json:"parentHash,omitempty"`
	ExplorerURL       string  `json:"explorerUrl"`
	Date              string  `json:"date"`
	Timestamp         int64   `json:"timestamp"`
	Direction         string  `json:"direction"`
	Amount            float64 `json:"amount"`
	Fee               float64 `json:"fee"`
	Status            string  `json:"status"`
	BlockNumber       int64   `json:"blockNumber"`
	BlockHash         string  `json:"blockHash,omitempty"`
	TransactionIndex  int64   `json:"transactionIndex"`
	From              string  `json:"from"`
	To                string  `json:"to"`
	Nonce             int64   `json:"nonce"`
	Gas               int64   `json:"gas"`
	GasPrice          string  `json:"gasPrice,omitempty"`
	GasUsed           int64   `json:"gasUsed"`
	EffectiveGasPrice string  `json:"effectiveGasPrice,omitempty"`
	Input             string  `json:"input"`
	MethodID          string  `json:"methodId,omitempty"`
	FunctionName      string  `json:"functionName,omitempty"`
	ContractAddress   string  `json:"contractAddress,omitempty"`
	CumulativeGasUsed int64   `json:"cumulativeGasUsed"`
	Confirmations     int64   `json:"confirmations"`
	IsError           string  `json:"isError"`
	TxReceiptStatus   string  `json:"txReceiptStatus"`
	TraceID           string  `json:"traceId,omitempty"`
	InternalType      string  `json:"internalType,omitempty"`
	ErrCode           string  `json:"errCode,omitempty"`
}

type EthAnalyzeResponse struct {
	Chain                   string      `json:"chain"`
	Address                 string      `json:"address"`
	Balance                 float64     `json:"balance"`
	TotalOnChain            int         `json:"totalOnChain"`
	TotalReceived           float64     `json:"totalReceived"`
	TotalSent               float64     `json:"totalSent"`
	TotalOnChainNormal      int         `json:"totalOnChainNormal"`
	TotalOnChainNormalExact bool        `json:"totalOnChainNormalExact"`
	RequestedFetch          int         `json:"requestedFetch"`
	IncludeInternal         bool        `json:"includeInternal"`
	FetchedNormal           int         `json:"fetchedNormal"`
	FetchedInternal         int         `json:"fetchedInternal"`
	Fetched                 int         `json:"fetched"`
	AfterFilters            int         `json:"afterFilters"`
	TotalIn                 float64     `json:"totalIn"`
	TotalOut                float64     `json:"totalOut"`
	NetFlow                 float64     `json:"netFlow"`
	IncomingTx              int         `json:"incomingTx"`
	OutgoingTx              int         `json:"outgoingTx"`
	ContractTx              int         `json:"contractTx"`
	SkippedNeutral          int         `json:"skippedNeutral"`
	Transactions            []EthTxView `json:"transactions"`
	Warnings                []string    `json:"warnings,omitempty"`
}

type ethFilterParams struct {
	DateFrom  *time.Time
	DateTo    *time.Time
	MinETH    *float64
	MaxETH    *float64
	Direction string
}

type ethTagged struct {
	ts   int64
	view EthTxView
}

func ethscanAddressURL(address string) string {
	return ethExplorerBase + "/address/" + strings.TrimSpace(address)
}

func ethscanTxURL(hash string) string {
	h := strings.TrimSpace(hash)
	return ethExplorerBase + "/tx/" + h
}

func ethSummaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if address == "" || !ethAddressRegex.MatchString(address) {
		http.Error(w, "valid eth address required", http.StatusBadRequest)
		return
	}
	if isOfflineDemoETH(address) {
		writeJSON(w, offlineETHSummary())
		return
	}
	s, err := fetchEthSummary(r.Context(), address)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, s)
}

func ethAnalyzeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	address := strings.TrimSpace(q.Get("address"))
	if address == "" || !ethAddressRegex.MatchString(address) {
		http.Error(w, "valid eth address required", http.StatusBadRequest)
		return
	}

	maxFetch, err := strconv.Atoi(strings.TrimSpace(q.Get("maxTx")))
	if err != nil || maxFetch < 1 {
		maxFetch = 100
	}
	if maxFetch > ethMaxFetchPerRequest {
		maxFetch = ethMaxFetchPerRequest
	}

	includeInternal := strings.EqualFold(strings.TrimSpace(q.Get("includeInternal")), "1") ||
		strings.EqualFold(strings.TrimSpace(q.Get("includeInternal")), "true")

	filters, ferr := parseEthFilters(q)
	if ferr != nil {
		http.Error(w, ferr.Error(), http.StatusBadRequest)
		return
	}
	if isOfflineDemoETH(address) {
		writeJSON(w, offlineETHAnalyze(maxFetch, filters, includeInternal))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), ethAnalyzeHTTPTimeout)
	defer cancel()

	resp, err := analyzeEthereumRich(ctx, address, maxFetch, filters, includeInternal)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, resp)
}

func parseEthFilters(q url.Values) (*ethFilterParams, error) {
	f := &ethFilterParams{Direction: strings.ToLower(strings.TrimSpace(q.Get("direction")))}

	if f.Direction != "" && f.Direction != "in" && f.Direction != "out" && f.Direction != "contract" {
		return nil, fmt.Errorf("direction must be in, out, contract or empty")
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

	if s := strings.TrimSpace(q.Get("minEth")); s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < 0 {
			return nil, fmt.Errorf("minEth invalid")
		}
		f.MinETH = &v
	}
	if s := strings.TrimSpace(q.Get("maxEth")); s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < 0 {
			return nil, fmt.Errorf("maxEth invalid")
		}
		f.MaxETH = &v
	}
	return f, nil
}

func fetchEthBalanceWei(ctx context.Context, address string) (string, error) {
	u := fmt.Sprintf("%s?module=account&action=balance&address=%s", ethBlockscoutAPI, url.QueryEscape(address))
	var resp ethBalanceResponse
	if err := fetchJSONCtx(ctx, u, &resp, ethSingleFetchTimeout); err != nil {
		return "", err
	}
	if resp.Status != "1" {
		return "", fmt.Errorf("blockscout balance: %s", resp.Message)
	}
	if resp.Result == "" {
		return "0", nil
	}
	return resp.Result, nil
}

func ethNaiveTotalsETH(addr string, txs []ethRawTx) (recv, sent float64) {
	al := strings.ToLower(strings.TrimSpace(addr))
	for _, tx := range txs {
		f := strings.ToLower(strings.TrimSpace(tx.From))
		t := strings.ToLower(strings.TrimSpace(tx.To))
		v := weiToEth(tx.Value)
		fee := ethFeeEth(&tx)
		if f == al {
			sent += v + fee
		}
		if t == al {
			recv += v
		}
	}
	return roundTo(recv, 8), roundTo(sent, 8)
}

type rpcReceiptObj struct {
	Status          string `json:"status"`
	TransactionHash string `json:"transactionHash"`
}

func fetchEthReceiptSuccessMap(ctx context.Context, hashes []string) map[string]bool {
	out := make(map[string]bool)
	uniq := make([]string, 0, len(hashes))
	seen := map[string]struct{}{}
	for _, h := range hashes {
		h = strings.TrimSpace(strings.ToLower(h))
		if h == "" {
			continue
		}
		if _, ok := seen[h]; ok {
			continue
		}
		seen[h] = struct{}{}
		uniq = append(uniq, h)
	}
	if len(uniq) == 0 {
		return out
	}

	client := &http.Client{Timeout: 60 * time.Second}
	for i := 0; i < len(uniq); i += ethReceiptBatchSize {
		end := i + ethReceiptBatchSize
		if end > len(uniq) {
			end = len(uniq)
		}
		chunk := uniq[i:end]
		batch := make([]map[string]any, 0, len(chunk))
		for j, h := range chunk {
			batch = append(batch, map[string]any{
				"jsonrpc": "2.0",
				"id":      j,
				"method":  "eth_getTransactionReceipt",
				"params":  []string{h},
			})
		}
		body, err := json.Marshal(batch)
		if err != nil {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, ethPublicRPC, bytes.NewReader(body))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		respBody, rerr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if rerr != nil || resp.StatusCode >= 400 {
			continue
		}
		var arr []struct {
			ID     int             `json:"id"`
			Result json.RawMessage `json:"result"`
		}
		if json.Unmarshal(respBody, &arr) != nil {
			continue
		}
		for _, el := range arr {
			if el.Result == nil || string(el.Result) == "null" {
				continue
			}
			var rc rpcReceiptObj
			if json.Unmarshal(el.Result, &rc) != nil {
				continue
			}
			h := strings.ToLower(strings.TrimSpace(rc.TransactionHash))
			if h == "" && el.ID >= 0 && el.ID < len(chunk) {
				h = chunk[el.ID]
			}
			if h == "" {
				continue
			}
			ok := strings.EqualFold(strings.TrimSpace(rc.Status), "0x1")
			out[h] = ok
		}
	}
	return out
}

func fetchEthSummary(ctx context.Context, address string) (EthSummaryResponse, error) {
	address = strings.TrimSpace(address)
	wei, err := fetchEthBalanceWei(ctx, address)
	if err != nil {
		return EthSummaryResponse{}, err
	}

	lower := strings.ToLower(address)
	countersURL := ethBlockscoutV2 + "/addresses/" + url.PathEscape(lower) + "/counters"

	var c ethV2Counters
	ntx := -1
	_ = fetchJSONCtx(ctx, countersURL, &c, ethSingleFetchTimeout)
	if v, err := strconv.Atoi(strings.TrimSpace(c.TransactionsCount)); err == nil && strings.TrimSpace(c.TransactionsCount) != "" {
		ntx = v
	}

	tr, ts := -1.0, -1.0
	if ntx == 0 {
		tr, ts = 0, 0
	} else if ntx > 0 && ntx <= ethSummaryTotalsMaxTx {
		txs, _, err := paginateEthTxlist(ctx, address, ntx)
		if err == nil {
			tr, ts = ethNaiveTotalsETH(address, txs)
		}
	}

	return EthSummaryResponse{
		Chain:         "ethereum",
		Address:       address,
		NTx:           ntx,
		Balance:       roundTo(weiToEth(wei), 8),
		TotalReceived: tr,
		TotalSent:     ts,
		NUnredeemed:   0,
	}, nil
}

func analyzeEthereumRich(ctx context.Context, address string, maxFetch int, filters *ethFilterParams, includeInternal bool) (EthAnalyzeResponse, error) {
	requestedIn := maxFetch
	want := maxFetch
	if want > ethMaxFetchPerRequest {
		want = ethMaxFetchPerRequest
	}

	meta, err := fetchEthSummary(ctx, address)
	if err != nil {
		return EthAnalyzeResponse{}, err
	}
	bal := meta.Balance

	normal, normalExact, err := paginateEthTxlist(ctx, address, want)
	if err != nil {
		return EthAnalyzeResponse{}, err
	}

	var internal []ethInternalRaw
	if includeInternal {
		var ierr error
		internal, _, ierr = paginateEthInternal(ctx, address, want)
		if ierr != nil {
			return EthAnalyzeResponse{}, ierr
		}
	}

	normalHashes := make([]string, 0, len(normal))
	for _, tx := range normal {
		if h := strings.TrimSpace(tx.Hash); h != "" {
			normalHashes = append(normalHashes, h)
		}
	}
	receiptOK := fetchEthReceiptSuccessMap(ctx, normalHashes)

	tagged := make([]ethTagged, 0, len(normal)+len(internal))
	for _, tx := range normal {
		h := strings.TrimSpace(strings.ToLower(tx.Hash))
		ok, seen := receiptOK[h]
		if !seen {
			ok = true
		}
		v := buildEthTxViewFromNormal(address, tx, ok)
		tagged = append(tagged, ethTagged{ts: v.Timestamp, view: v})
	}
	for _, tx := range internal {
		ph := strings.TrimSpace(strings.ToLower(tx.TransactionHash))
		if ph == "" {
			ph = strings.TrimSpace(strings.ToLower(tx.Hash))
		}
		ok, seen := receiptOK[ph]
		if !seen {
			ok = true
		}
		v := buildEthTxViewFromInternal(address, tx, ok)
		tagged = append(tagged, ethTagged{ts: v.Timestamp, view: v})
	}
	sort.Slice(tagged, func(i, j int) bool {
		if tagged[i].ts == tagged[j].ts {
			ki := tagged[i].view.Hash + tagged[i].view.TraceID
			kj := tagged[j].view.Hash + tagged[j].view.TraceID
			return ki > kj
		}
		return tagged[i].ts > tagged[j].ts
	})
	if len(tagged) > want {
		tagged = tagged[:want]
	}

	var warnings []string
	if meta.NTx >= 0 && requestedIn > meta.NTx {
		warnings = append(warnings, fmt.Sprintf("запрошено %d, в сети у адреса %d транзакций", requestedIn, meta.NTx))
	}

	legacyOnChain := len(normal)
	if !normalExact {
		legacyOnChain = -1
	}

	totalOnChain := meta.NTx
	if totalOnChain < 0 {
		if normalExact {
			totalOnChain = len(normal)
		} else {
			totalOnChain = -1
		}
	}

	var (
		out           []EthTxView
		totalIn       float64
		totalOut      float64
		inC, outC, cC int
	)
	for _, t := range tagged {
		v := t.view
		if !ethTxMatchesFilters(v, filters) {
			continue
		}
		out = append(out, v)
		switch v.Direction {
		case "in":
			totalIn += v.Amount
			inC++
		case "out":
			totalOut += v.Amount
			outC++
		case "contract":
			cC++
		}
	}

	return EthAnalyzeResponse{
		Chain:                   "ethereum",
		Address:                 address,
		Balance:                 bal,
		TotalOnChain:            totalOnChain,
		TotalReceived:           meta.TotalReceived,
		TotalSent:               meta.TotalSent,
		TotalOnChainNormal:      legacyOnChain,
		TotalOnChainNormalExact: normalExact,
		RequestedFetch:          requestedIn,
		IncludeInternal:         includeInternal,
		FetchedNormal:           len(normal),
		FetchedInternal:         len(internal),
		Fetched:                 len(tagged),
		AfterFilters:            len(out),
		TotalIn:                 roundTo(totalIn, 8),
		TotalOut:                roundTo(totalOut, 8),
		NetFlow:                 roundTo(totalIn-totalOut, 8),
		IncomingTx:              inC,
		OutgoingTx:              outC,
		ContractTx:              cC,
		SkippedNeutral:          0,
		Transactions:            out,
		Warnings:                warnings,
	}, nil
}

func paginateEthTxlist(ctx context.Context, address string, want int) ([]ethRawTx, bool, error) {
	var all []ethRawTx
	page := 1
	for len(all) < want {
		if err := ctx.Err(); err != nil {
			return all, false, err
		}
		q := url.Values{}
		q.Set("module", "account")
		q.Set("action", "txlist")
		q.Set("address", address)
		q.Set("startblock", "0")
		q.Set("endblock", "99999999")
		q.Set("page", strconv.Itoa(page))
		q.Set("offset", strconv.Itoa(ethPageSize))
		q.Set("sort", "desc")
		u := ethBlockscoutAPI + "?" + q.Encode()

		var resp ethTxlistResponse
		if err := fetchJSONCtx(ctx, u, &resp, ethSingleFetchTimeout); err != nil {
			return all, false, fmt.Errorf("eth txlist page %d: %w", page, err)
		}
		if resp.Status != "1" || len(resp.Result) == 0 {
			return all, true, nil
		}
		for _, tx := range resp.Result {
			all = append(all, tx)
			if len(all) >= want {
				return all, len(resp.Result) < ethPageSize, nil
			}
		}
		if len(resp.Result) < ethPageSize {
			return all, true, nil
		}
		page++
		select {
		case <-ctx.Done():
			return all, false, ctx.Err()
		case <-time.After(ethPageThrottle):
		}
	}
	return all, false, nil
}

func paginateEthInternal(ctx context.Context, address string, want int) ([]ethInternalRaw, bool, error) {
	var all []ethInternalRaw
	page := 1
	for len(all) < want {
		if err := ctx.Err(); err != nil {
			return all, false, err
		}
		q := url.Values{}
		q.Set("module", "account")
		q.Set("action", "txlistinternal")
		q.Set("address", address)
		q.Set("startblock", "0")
		q.Set("endblock", "99999999")
		q.Set("page", strconv.Itoa(page))
		q.Set("offset", strconv.Itoa(ethPageSize))
		q.Set("sort", "desc")
		u := ethBlockscoutAPI + "?" + q.Encode()

		var resp ethInternalListResponse
		if err := fetchJSONCtx(ctx, u, &resp, ethSingleFetchTimeout); err != nil {
			return all, false, fmt.Errorf("eth internal page %d: %w", page, err)
		}
		if resp.Status != "1" || len(resp.Result) == 0 {
			return all, true, nil
		}
		for _, tx := range resp.Result {
			all = append(all, tx)
			if len(all) >= want {
				return all, len(resp.Result) < ethPageSize, nil
			}
		}
		if len(resp.Result) < ethPageSize {
			return all, true, nil
		}
		page++
		select {
		case <-ctx.Done():
			return all, false, ctx.Err()
		case <-time.After(ethPageThrottle):
		}
	}
	return all, false, nil
}

func ethFeeEth(tx *ethRawTx) float64 {
	gu := mustBigIntString(tx.GasUsed)
	if gu == nil || gu.Sign() == 0 {
		return 0
	}
	var price *big.Int
	if strings.TrimSpace(tx.EffectiveGasPrice) != "" {
		price = mustBigIntString(tx.EffectiveGasPrice)
	}
	if price == nil || price.Sign() == 0 {
		price = mustBigIntString(tx.GasPrice)
	}
	if price == nil {
		return 0
	}
	wei := new(big.Int).Mul(price, gu)
	return weiBigToEth(wei)
}

func ethInternalFeeEth(tx *ethInternalRaw) float64 {
	_ = tx
	return 0
}

func mustBigIntString(s string) *big.Int {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	z, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil
	}
	return z
}

func weiBigToEth(wei *big.Int) float64 {
	if wei == nil {
		return 0
	}
	f, _ := new(big.Rat).SetFrac(wei, big.NewInt(1_000_000_000_000_000_000)).Float64()
	return roundTo(f, 8)
}

func buildEthTxViewFromNormal(addr string, tx ethRawTx, succeeded bool) EthTxView {
	rawValue := weiToEth(tx.Value)
	fee := ethFeeEth(&tx)
	fromSelf := strings.EqualFold(tx.From, addr)

	value := rawValue
	if !succeeded {
		value = 0
		if !fromSelf {
			fee = 0
		}
	}

	direction := "contract"
	if value > 0 && fromSelf {
		direction = "out"
	} else if value > 0 {
		direction = "in"
	} else if !succeeded && fromSelf && fee > 0 {
		direction = "out"
	}

	ts := parseInt64(tx.TimeStamp)
	date := time.Unix(ts, 0).UTC().Format(time.RFC3339)
	status := "confirmed"
	if !succeeded {
		status = "failed"
	}

	hn := strings.TrimSpace(tx.Hash)
	return EthTxView{
		Kind:              "normal",
		Hash:              hn,
		ExplorerURL:       ethscanTxURL(hn),
		Date:              date,
		Timestamp:         ts,
		Direction:         direction,
		Amount:            roundTo(value, 8),
		Fee:               roundTo(fee, 8),
		Status:            status,
		BlockNumber:       parseInt64(tx.BlockNumber),
		BlockHash:         tx.BlockHash,
		TransactionIndex:  parseInt64(tx.TransactionIndex),
		From:              tx.From,
		To:                tx.To,
		Nonce:             parseInt64(tx.Nonce),
		Gas:               parseInt64(tx.Gas),
		GasPrice:          tx.GasPrice,
		GasUsed:           parseInt64(tx.GasUsed),
		EffectiveGasPrice: tx.EffectiveGasPrice,
		Input:             tx.Input,
		MethodID:          tx.MethodID,
		FunctionName:      tx.FunctionName,
		ContractAddress:   tx.ContractAddress,
		CumulativeGasUsed: parseInt64(tx.CumulativeGasUsed),
		Confirmations:     parseInt64(tx.Confirmations),
		IsError:           tx.IsError,
		TxReceiptStatus:   tx.TxReceiptStatus,
	}
}

func buildEthTxViewFromInternal(addr string, tx ethInternalRaw, parentSucceeded bool) EthTxView {
	rawValue := weiToEth(tx.Value)
	fee := ethInternalFeeEth(&tx)
	fromSelf := strings.EqualFold(tx.From, addr)

	value := rawValue
	if !parentSucceeded {
		value = 0
		fee = 0
	}

	direction := "contract"
	if value > 0 && fromSelf {
		direction = "out"
	} else if value > 0 {
		direction = "in"
	}

	ts := parseInt64(tx.TimeStamp)
	date := time.Unix(ts, 0).UTC().Format(time.RFC3339)
	status := "confirmed"
	if !parentSucceeded || tx.IsError == "1" {
		status = "failed"
	}

	h := strings.TrimSpace(tx.Hash)
	if h == "" {
		h = strings.TrimSpace(tx.TransactionHash)
	}
	parent := strings.TrimSpace(tx.TransactionHash)
	if parent == "" {
		parent = h
	}

	return EthTxView{
		Kind:            "internal",
		Hash:            h,
		ParentHash:      tx.TransactionHash,
		ExplorerURL:     ethscanTxURL(parent),
		Date:            date,
		Timestamp:       ts,
		Direction:       direction,
		Amount:          roundTo(value, 8),
		Fee:             roundTo(fee, 8),
		Status:          status,
		BlockNumber:     parseInt64(tx.BlockNumber),
		From:            tx.From,
		To:              tx.To,
		Gas:             parseInt64(tx.Gas),
		GasUsed:         parseInt64(tx.GasUsed),
		Input:           tx.Input,
		ContractAddress: tx.ContractAddress,
		IsError:         tx.IsError,
		TxReceiptStatus: "",
		TraceID:         tx.TraceID,
		InternalType:    tx.Type,
		ErrCode:         tx.ErrCode,
	}
}

func ethTxMatchesFilters(v EthTxView, f *ethFilterParams) bool {
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
	if f.MinETH != nil && amt < *f.MinETH {
		return false
	}
	if f.MaxETH != nil && amt > *f.MaxETH {
		return false
	}
	return true
}

func analyzeEthereumLegacy(address string) (AnalyzeResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	raw, _, err := paginateEthTxlist(ctx, address, 50)
	if err != nil {
		return AnalyzeResponse{}, err
	}

	wei, err := fetchEthBalanceWei(ctx, address)
	if err != nil {
		return AnalyzeResponse{}, err
	}

	rcHashes := make([]string, 0, len(raw))
	for _, tx := range raw {
		if h := strings.TrimSpace(tx.Hash); h != "" {
			rcHashes = append(rcHashes, h)
		}
	}
	receiptOK := fetchEthReceiptSuccessMap(ctx, rcHashes)

	view := AnalyzeResponse{
		Chain:        "ethereum",
		Address:      address,
		Balance:      roundTo(weiToEth(wei), 8),
		TotalTx:      len(raw),
		Transactions: make([]TxView, 0, len(raw)),
	}

	var totalIn, totalOut float64
	for _, tx := range raw {
		h := strings.TrimSpace(strings.ToLower(tx.Hash))
		ok, seen := receiptOK[h]
		if !seen {
			ok = true
		}
		ev := buildEthTxViewFromNormal(address, tx, ok)
		if ev.Direction == "contract" {
			view.ContractTx++
		} else if ev.Direction == "out" {
			totalOut += ev.Amount
			view.OutgoingTx++
		} else if ev.Direction == "in" {
			totalIn += ev.Amount
			view.IncomingTx++
		}
		view.Transactions = append(view.Transactions, TxView{
			Hash:      ev.Hash,
			Date:      ev.Date,
			Direction: ev.Direction,
			Amount:    ev.Amount,
			From:      ev.From,
			To:        ev.To,
			Fee:       ev.Fee,
			Status:    ev.Status,
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
