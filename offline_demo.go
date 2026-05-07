package main

import (
	"fmt"
	"strings"
	"time"
)

const (
	demoBTCAddress = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
	demoETHAddress = "0x1111111122222222333333334444444455555555"
	demoTxCount    = 1000
)

func isOfflineDemoBTC(address string) bool {
	return strings.EqualFold(strings.TrimSpace(address), demoBTCAddress)
}

func isOfflineDemoETH(address string) bool {
	return strings.EqualFold(strings.TrimSpace(address), demoETHAddress)
}

func offlineBTCSummary() BtcSummaryResponse {
	txs := offlineBTCTxs()
	var recv, sent float64
	for _, tx := range txs {
		if tx.Direction == "in" {
			recv += tx.Amount
		}
		if tx.Direction == "out" {
			sent += tx.Amount
		}
	}
	balance := roundTo(recv-sent, 8)
	if balance < 0 {
		balance = 0
	}
	return BtcSummaryResponse{
		Chain:         "bitcoin",
		Address:       demoBTCAddress,
		NTx:           len(txs),
		NUnredeemed:   240,
		Balance:       balance,
		TotalReceived: roundTo(recv, 8),
		TotalSent:     roundTo(sent, 8),
	}
}

func offlineBTCAnalyze(maxFetch int, filters *btcFilterParams) BtcAnalyzeResponse {
	all := offlineBTCTxs()
	limit := maxFetch
	if limit < 1 {
		limit = 1
	}
	if limit > len(all) {
		limit = len(all)
	}
	selected := all[:limit]
	var (
		out      []BtcTxView
		totalIn  float64
		totalOut float64
		inCount  int
		outCount int
	)
	for _, tx := range selected {
		if !btcTxMatchesFilters(tx, filters) {
			continue
		}
		out = append(out, tx)
		if tx.Direction == "in" {
			totalIn += tx.Amount
			inCount++
		}
		if tx.Direction == "out" {
			totalOut += tx.Amount
			outCount++
		}
	}
	summary := offlineBTCSummary()
	return BtcAnalyzeResponse{
		Chain:          "bitcoin",
		Address:        demoBTCAddress,
		Balance:        summary.Balance,
		TotalOnChain:   len(all),
		TotalReceived:  summary.TotalReceived,
		TotalSent:      summary.TotalSent,
		RequestedFetch: maxFetch,
		Fetched:        len(selected),
		AfterFilters:   len(out),
		TotalIn:        roundTo(totalIn, 8),
		TotalOut:       roundTo(totalOut, 8),
		NetFlow:        roundTo(totalIn-totalOut, 8),
		IncomingTx:     inCount,
		OutgoingTx:     outCount,
		SkippedNeutral: 0,
		Transactions:   out,
		Warnings:       []string{"Офлайн-демо: локальные данные на 1000 транзакций"},
	}
}

func offlineETHSummary() EthSummaryResponse {
	txs := offlineETHTxs()
	var recv, sent float64
	for _, tx := range txs {
		if tx.Direction == "in" {
			recv += tx.Amount
		}
		if tx.Direction == "out" {
			sent += tx.Amount
		}
	}
	balance := roundTo(recv-sent, 8)
	if balance < 0 {
		balance = 0
	}
	return EthSummaryResponse{
		Chain:         "ethereum",
		Address:       demoETHAddress,
		NTx:           len(txs),
		Balance:       balance,
		TotalReceived: roundTo(recv, 8),
		TotalSent:     roundTo(sent, 8),
		NUnredeemed:   0,
	}
}

func offlineETHAnalyze(maxFetch int, filters *ethFilterParams, includeInternal bool) EthAnalyzeResponse {
	all := offlineETHTxs()
	limit := maxFetch
	if limit < 1 {
		limit = 1
	}
	if limit > len(all) {
		limit = len(all)
	}
	selected := all[:limit]
	var (
		out               []EthTxView
		totalIn, totalOut float64
		inC, outC, cC     int
	)
	for _, tx := range selected {
		if !ethTxMatchesFilters(tx, filters) {
			continue
		}
		out = append(out, tx)
		switch tx.Direction {
		case "in":
			totalIn += tx.Amount
			inC++
		case "out":
			totalOut += tx.Amount
			outC++
		case "contract":
			cC++
		}
	}
	summary := offlineETHSummary()
	return EthAnalyzeResponse{
		Chain:                   "ethereum",
		Address:                 demoETHAddress,
		Balance:                 summary.Balance,
		TotalOnChain:            len(all),
		TotalReceived:           summary.TotalReceived,
		TotalSent:               summary.TotalSent,
		TotalOnChainNormal:      len(all),
		TotalOnChainNormalExact: true,
		RequestedFetch:          maxFetch,
		IncludeInternal:         includeInternal,
		FetchedNormal:           len(selected),
		FetchedInternal:         0,
		Fetched:                 len(selected),
		AfterFilters:            len(out),
		TotalIn:                 roundTo(totalIn, 8),
		TotalOut:                roundTo(totalOut, 8),
		NetFlow:                 roundTo(totalIn-totalOut, 8),
		IncomingTx:              inC,
		OutgoingTx:              outC,
		ContractTx:              cC,
		SkippedNeutral:          0,
		Transactions:            out,
		Warnings:                []string{"Офлайн-демо: локальные данные на 1000 транзакций"},
	}
}

func offlineBTCTxs() []BtcTxView {
	base := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	out := make([]BtcTxView, 0, demoTxCount)
	for i := 0; i < demoTxCount; i++ {
		ts := base.Add(-time.Duration(i*3) * time.Hour).Unix()
		isIn := i%3 != 0
		amt := roundTo(0.0025+float64((i%23))*0.00041, 8)
		fee := roundTo(0.000006+float64((i%17))*0.0000011, 8)
		direction := "in"
		from := fmt.Sprintf("bc1qsource%04dxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", i)
		to := demoBTCAddress
		if !isIn {
			direction = "out"
			from = demoBTCAddress
			to = fmt.Sprintf("bc1qdest%04dyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", i)
		}
		hash := fmt.Sprintf("btc_demo_%04d_%060d", i, i+7)
		inputs := []BtcIOView{{Addr: from, Value: roundTo(amt+fee, 8), Index: 0, Spent: true}}
		outputs := []BtcIOView{{Addr: to, Value: amt, Index: 0, Spent: i%5 == 0}}
		if !isIn {
			change := roundTo(0.0004+float64((i%7))*0.00005, 8)
			outputs = append(outputs, BtcIOView{Addr: demoBTCAddress, Value: change, Index: 1, Spent: true})
		}
		out = append(out, BtcTxView{
			Hash:          hash,
			ExplorerURL:   "https://mempool.space/tx/" + hash,
			Date:          time.Unix(ts, 0).UTC().Format(time.RFC3339),
			Timestamp:     ts,
			Direction:     direction,
			Amount:        amt,
			Fee:           fee,
			Status:        "confirmed",
			BlockHeight:   900000 - i,
			BlockIndex:    i % 125,
			Version:       2,
			VinSz:         len(inputs),
			VoutSz:        len(outputs),
			Size:          190 + (i % 350),
			Weight:        760 + (i % 1400),
			LockTime:      0,
			RelayedBy:     "offline.demo",
			DoubleSpend:   false,
			TxIndex:       int64(5000000 + i),
			From:          from,
			To:            to,
			Inputs:        inputs,
			Outputs:       outputs,
			TotalInValue:  roundTo(amt+fee, 8),
			TotalOutValue: roundTo(amt, 8),
		})
	}
	return out
}

func offlineETHTxs() []EthTxView {
	base := time.Date(2026, 5, 1, 11, 0, 0, 0, time.UTC)
	out := make([]EthTxView, 0, demoTxCount)
	for i := 0; i < demoTxCount; i++ {
		ts := base.Add(-time.Duration(i*2) * time.Hour).Unix()
		dir := "in"
		if i%5 == 0 {
			dir = "contract"
		} else if i%2 == 0 {
			dir = "out"
		}
		amt := roundTo(0.015+float64((i%29))*0.0037, 8)
		if dir == "contract" {
			amt = 0
		}
		fee := roundTo(0.00021+float64((i%19))*0.00003, 8)
		from := fmt.Sprintf("0x%040x", 100000+i)
		to := demoETHAddress
		if dir != "in" {
			from = demoETHAddress
			to = fmt.Sprintf("0x%040x", 200000+i)
		}
		hash := fmt.Sprintf("0x%064x", 900000+i)
		status := "confirmed"
		if i%37 == 0 {
			status = "failed"
		}
		out = append(out, EthTxView{
			Kind:              "normal",
			Hash:              hash,
			ExplorerURL:       "https://ethscan.org/tx/" + hash,
			Date:              time.Unix(ts, 0).UTC().Format(time.RFC3339),
			Timestamp:         ts,
			Direction:         dir,
			Amount:            amt,
			Fee:               fee,
			Status:            status,
			BlockNumber:       int64(23000000 - i),
			TransactionIndex:  int64(i % 100),
			From:              from,
			To:                to,
			Nonce:             int64(1000 + i),
			Gas:               21000 + int64(i%20)*7000,
			GasPrice:          fmt.Sprintf("%d", 20_000_000_000+int64(i%35)*1_000_000_000),
			GasUsed:           21000 + int64(i%15)*5000,
			EffectiveGasPrice: fmt.Sprintf("%d", 19_500_000_000+int64(i%35)*900_000_000),
			Input:             "0x",
			MethodID:          "",
			FunctionName:      "",
			ContractAddress:   "",
			CumulativeGasUsed: 3_000_000 + int64(i*3000),
			Confirmations:     int64(100000 + i),
			IsError:           "0",
			TxReceiptStatus:   "1",
		})
	}
	return out
}
