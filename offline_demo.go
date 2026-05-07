package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	presetBTCAddress = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
	presetETHAddress = "0x1111111122222222333333334444444455555555"
	presetTxCount    = 1000
)

func isPresetBTC(address string) bool {
	return strings.EqualFold(strings.TrimSpace(address), presetBTCAddress)
}

func isPresetETH(address string) bool {
	return strings.EqualFold(strings.TrimSpace(address), presetETHAddress)
}

func presetBTCSummary() BtcSummaryResponse {
	txs := presetBTCTxs()
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
		Address:       presetBTCAddress,
		NTx:           len(txs),
		NUnredeemed:   240,
		Balance:       balance,
		TotalReceived: roundTo(recv, 8),
		TotalSent:     roundTo(sent, 8),
	}
}

func presetBTCAnalyze(maxFetch int, filters *btcFilterParams) BtcAnalyzeResponse {
	all := presetBTCTxs()
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
	summary := presetBTCSummary()
	return BtcAnalyzeResponse{
		Chain:          "bitcoin",
		Address:        presetBTCAddress,
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
		Warnings:       nil,
	}
}

func presetETHSummary() EthSummaryResponse {
	txs := presetETHTxs()
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
		Address:       presetETHAddress,
		NTx:           len(txs),
		Balance:       balance,
		TotalReceived: roundTo(recv, 8),
		TotalSent:     roundTo(sent, 8),
		NUnredeemed:   0,
	}
}

func presetETHAnalyze(maxFetch int, filters *ethFilterParams, includeInternal bool) EthAnalyzeResponse {
	all := presetETHTxs()
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
	summary := presetETHSummary()
	return EthAnalyzeResponse{
		Chain:                   "ethereum",
		Address:                 presetETHAddress,
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
		Warnings:                nil,
	}
}

func presetBTCTxs() []BtcTxView {
	base := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	out := make([]BtcTxView, 0, presetTxCount)
	sourcePool := []string{
		"bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
		"bc1q8c6fshw2dlx0m3w8z8e6p6myv6pq0r8s9zq3hg",
		"bc1qk0d8p4j9v7r5s3m2n1x9c8b7a6l5k4j3h2g1f0",
		"bc1qt8w5d3h9k2m4n6p8r0s1u3v5x7y9z2a4c6e8f0",
	}
	destPool := []string{
		"bc1q2n7k0axp5s3dr9w6v8u4t1m0lq2y7c3f5e9h0j",
		"bc1qjv8x4m6n2p9r0s5t1u7w3y8z4a6c2e9f0g3h5k",
		"bc1q5c8f2h7k9m1p3r6t0v4x8y2z5a9d1e4g7j0l3n",
	}
	makeTxID := func(i int) string {
		sum := sha256.Sum256([]byte(fmt.Sprintf("btc:%s:%d:%d", presetBTCAddress, presetTxCount, i)))
		return hex.EncodeToString(sum[:])
	}
	makeAddr := func(prefix string, i int) string {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", prefix, i)))
		raw := hex.EncodeToString(sum[:])
		return "bc1q" + raw[:36]
	}
	for i := 0; i < presetTxCount; i++ {
		ts := base.Add(-time.Duration(i*3) * time.Hour).Unix()
		isIn := i%3 != 0
		fee := roundTo(0.0000012+float64((i%29))*0.00000018, 8)
		from := sourcePool[i%len(sourcePool)]
		to := presetBTCAddress
		if !isIn {
			from = presetBTCAddress
			to = destPool[i%len(destPool)]
		}
		hash := makeTxID(i)

		inputCount := 1 + (i % 5) // 1..5
		outputCount := 1 + ((i / 3) % 6)
		if outputCount < 1 {
			outputCount = 1
		}
		if outputCount > 7 {
			outputCount = 7
		}

		var inputs []BtcIOView
		var outputs []BtcIOView

		if isIn {
			creditParts := 1 + (i % 3) // 1..3 outputs to wallet
			if creditParts > outputCount {
				creditParts = outputCount
			}
			var totalCred float64
			for k := 0; k < creditParts; k++ {
				v := roundTo(0.0012+float64(((i+k)%71))*0.000037, 8)
				totalCred += v
				outputs = append(outputs, BtcIOView{
					Addr:  presetBTCAddress,
					Value: v,
					Index: k,
					Spent: (i+k)%9 == 0,
				})
			}
			amount := roundTo(totalCred, 8)

			var totalIn float64
			for j := 0; j < inputCount; j++ {
				addr := from
				if j > 0 {
					addr = makeAddr("src", i*17+j)
				}
				v := roundTo((amount+fee)*0.65/float64(inputCount)+float64(j)*0.00007, 8)
				totalIn += v
				inputs = append(inputs, BtcIOView{
					Addr:  addr,
					Value: v,
					Index: j,
					Spent: true,
				})
			}
			restCount := outputCount - len(outputs)
			for k := 0; k < restCount; k++ {
				outputs = append(outputs, BtcIOView{
					Addr:  makeAddr("out", i*31+k),
					Value: roundTo(0.00018+float64((i+k)%11)*0.00003, 8),
					Index: len(outputs),
					Spent: true,
				})
			}

			out = append(out, BtcTxView{
				Hash:          hash,
				ExplorerURL:   "https://mempool.space/tx/" + hash,
				Date:          time.Unix(ts, 0).UTC().Format(time.RFC3339),
				Timestamp:     ts,
				Direction:     "in",
				Amount:        amount,
				Fee:           0,
				Status:        "confirmed",
				BlockHeight:   900000 - i,
				BlockIndex:    i % 125,
				Version:       2,
				VinSz:         len(inputs),
				VoutSz:        len(outputs),
				Size:          190 + (i % 520),
				Weight:        760 + (i % 2100),
				LockTime:      0,
				RelayedBy:     "mempool-gateway-01",
				DoubleSpend:   false,
				TxIndex:       int64(5000000 + i),
				From:          inputs[0].Addr,
				To:            presetBTCAddress,
				Inputs:        inputs,
				Outputs:       outputs,
				TotalInValue:  roundTo(totalIn, 8),
				TotalOutValue: roundTo(amount, 8),
			})
			continue
		}

		debitParts := 1 + (i % 4) // 1..4 external recipients
		if debitParts > outputCount {
			debitParts = outputCount
		}
		var sent float64
		for k := 0; k < debitParts; k++ {
			v := roundTo(0.0011+float64(((i+k)%83))*0.000031, 8)
			sent += v
			addr := to
			if k > 0 {
				addr = makeAddr("dst", i*19+k)
			}
			outputs = append(outputs, BtcIOView{
				Addr:  addr,
				Value: v,
				Index: k,
				Spent: false,
			})
		}
		change := roundTo(0.0002+float64((i%29))*0.000009, 8)
		outputs = append(outputs, BtcIOView{
			Addr:  presetBTCAddress,
			Value: change,
			Index: len(outputs),
			Spent: true,
		})
		for len(outputs) < outputCount {
			outputs = append(outputs, BtcIOView{
				Addr:  makeAddr("dust", i*13+len(outputs)),
				Value: roundTo(0.00005+float64((i%7))*0.00001, 8),
				Index: len(outputs),
				Spent: true,
			})
		}

		needIn := sent + change + fee
		var totalIn float64
		for j := 0; j < inputCount; j++ {
			addr := presetBTCAddress
			if j > 0 {
				addr = makeAddr("self", i*23+j)
			}
			v := roundTo(needIn/float64(inputCount)+float64((j%3))*0.00004, 8)
			totalIn += v
			inputs = append(inputs, BtcIOView{
				Addr:  addr,
				Value: v,
				Index: j,
				Spent: true,
			})
		}

		out = append(out, BtcTxView{
			Hash:          hash,
			ExplorerURL:   "https://mempool.space/tx/" + hash,
			Date:          time.Unix(ts, 0).UTC().Format(time.RFC3339),
			Timestamp:     ts,
			Direction:     "out",
			Amount:        roundTo(sent, 8),
			Fee:           fee,
			Status:        "confirmed",
			BlockHeight:   900000 - i,
			BlockIndex:    i % 125,
			Version:       2,
			VinSz:         len(inputs),
			VoutSz:        len(outputs),
			Size:          210 + (i % 720),
			Weight:        840 + (i % 2900),
			LockTime:      0,
			RelayedBy:     "mempool-gateway-01",
			DoubleSpend:   false,
			TxIndex:       int64(5000000 + i),
			From:          presetBTCAddress,
			To:            outputs[0].Addr,
			Inputs:        inputs,
			Outputs:       outputs,
			TotalInValue:  roundTo(totalIn, 8),
			TotalOutValue: roundTo(sent+change, 8),
		})
	}
	return out
}

func presetETHTxs() []EthTxView {
	base := time.Date(2026, 5, 1, 11, 0, 0, 0, time.UTC)
	out := make([]EthTxView, 0, presetTxCount)
	for i := 0; i < presetTxCount; i++ {
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
		to := presetETHAddress
		if dir != "in" {
			from = presetETHAddress
			to = fmt.Sprintf("0x%040x", 200000+i)
		}
		hash := fmt.Sprintf("0x%064x", 900000+i*41+13)
		status := "confirmed"
		isError := "0"
		receipt := "1"
		if i%37 == 0 {
			status = "failed"
			isError = "1"
			receipt = "0"
		}
		out = append(out, EthTxView{
			Kind:              "normal",
			Hash:              hash,
			ExplorerURL:       "https://etherscan.io/tx/" + hash,
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
			IsError:           isError,
			TxReceiptStatus:   receipt,
		})
	}
	return out
}
