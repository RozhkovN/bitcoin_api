package main

import (
	_ "embed"
	"net/http"
)

//go:embed previewdata/btc.json
var previewBTCJSON []byte

//go:embed previewdata/eth.json
var previewETHJSON []byte

func previewBTCHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(previewBTCJSON)
}

func previewETHHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(previewETHJSON)
}
