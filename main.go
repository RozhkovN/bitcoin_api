package main

import (
	"context"
	"crypto/tls"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed web/*
var embeddedWeb embed.FS

var (
	ethAddressRegex = regexp.MustCompile(`^0x[a-fA-F0-9]{40}$`)
	btcAddressRegex = regexp.MustCompile(`^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$`)
)

type AnalyzeResponse struct {
	Chain        string   `json:"chain"`
	Address      string   `json:"address"`
	Balance      float64  `json:"balance"`
	TotalIn      float64  `json:"totalIn"`
	TotalOut     float64  `json:"totalOut"`
	NetFlow      float64  `json:"netFlow"`
	TotalTx      int      `json:"totalTx"`
	IncomingTx   int      `json:"incomingTx"`
	OutgoingTx   int      `json:"outgoingTx"`
	ContractTx   int      `json:"contractTx"`
	Transactions []TxView `json:"transactions"`
}

type TxView struct {
	Hash      string  `json:"hash"`
	Date      string  `json:"date"`
	Direction string  `json:"direction"`
	Amount    float64 `json:"amount"`
	From      string  `json:"from"`
	To        string  `json:"to"`
	Fee       float64 `json:"fee,omitempty"`
	Status    string  `json:"status"`
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/btc/summary", btcSummaryHandler)
	mux.HandleFunc("/api/btc/analyze", btcAnalyzeHandler)
	mux.HandleFunc("/api/eth/summary", ethSummaryHandler)
	mux.HandleFunc("/api/eth/analyze", ethAnalyzeHandler)
	mux.HandleFunc("/api/analyze", analyzeWalletHandler)
	mux.HandleFunc("/p/btc", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/?demo=btc", http.StatusFound)
	})
	mux.HandleFunc("/p/eth", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/?demo=eth", http.StatusFound)
	})

	webFS, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(webFS)))

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "3400"
	}
	addr := ":" + port
	url := "http://localhost" + addr
	if shouldOpenBrowser() {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(url)
		}()
	}
	log.Printf("wallet analyzer started at http://localhost%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func shouldOpenBrowser() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("OPEN_BROWSER")))
	if v == "0" || v == "false" || v == "no" {
		return false
	}
	return true
}

func analyzeWalletHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if address == "" {
		http.Error(w, "address query param is required", http.StatusBadRequest)
		return
	}

	var (
		resp AnalyzeResponse
		err  error
	)

	switch {
	case ethAddressRegex.MatchString(address):
		resp, err = analyzeEthereumLegacy(address)
	case btcAddressRegex.MatchString(address):
		resp, err = analyzeBitcoinLegacy(address)
	default:
		http.Error(w, "unknown wallet format, supported: BTC or ETH", http.StatusBadRequest)
		return
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	writeJSON(w, resp)
}

func fetchJSON(url string, target any) error {
	return fetchJSONCtx(context.Background(), url, target, 12*time.Second)
}

func fetchJSONCtx(ctx context.Context, url string, target any, timeout time.Duration) error {
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			ForceAttemptHTTP2: false,
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; WalletAnalyzer/1.0; +https://localhost)")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func statusByConfirmations(confirmations int) string {
	if confirmations > 0 {
		return "confirmed"
	}
	return "pending"
}

func satoshiToCoin(v int64) float64 {
	return float64(v) / 100_000_000
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func roundTo(v float64, precision int) float64 {
	factor := math.Pow10(precision)
	return math.Round(v*factor) / factor
}

func parseNumber(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int64:
		return float64(t)
	case int:
		return float64(t)
	case string:
		parsed, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}

func weiToEth(v any) float64 {
	var raw string
	switch t := v.(type) {
	case string:
		raw = t
	case int64:
		raw = strconv.FormatInt(t, 10)
	case int:
		raw = strconv.Itoa(t)
	case float64:
		return t / 1_000_000_000_000_000_000
	default:
		return 0
	}

	if raw == "" {
		return 0
	}

	val, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0
	}
	return val / 1_000_000_000_000_000_000
}

func parseInt64(v string) int64 {
	parsed, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}
