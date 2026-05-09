package main

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GraphNode struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`       // сокращённый адрес для UI
	FullAddress string  `json:"fullAddress"` // полный адрес
	IsCenter    bool    `json:"isCenter"`
	Type        string  `json:"type"` // center | counterparty
	TxCount     int     `json:"txCount"`
	TotalIn     float64 `json:"totalIn"`
	TotalOut    float64 `json:"totalOut"`
	NetFlow     float64 `json:"netFlow"`
	FirstSeen   int64   `json:"firstSeen"`
	LastSeen    int64   `json:"lastSeen"`
	RiskScore   int     `json:"riskScore"` // 0‑100
	RiskLevel   string  `json:"riskLevel"` // low | medium | high | critical
	Badge       string  `json:"badge,omitempty"` // TRANSIT | DUST | MIXER | HIGH-VOL | FREQUENT
}

type GraphEdge struct {
	ID        string  `json:"id"`
	Source    string  `json:"source"`
	Target    string  `json:"target"`
	Value     float64 `json:"value"`
	TxCount   int     `json:"txCount"`  // агрегированных транзакций
	Timestamp int64   `json:"timestamp"` // самая поздняя
	Date      string  `json:"date"`
	Direction string  `json:"direction"` // in | out (относительно center)
	Hash      string  `json:"hash"`      // хэш последней tx
}

type RiskFactor struct {
	Name   string `json:"name"`
	Score  int    `json:"score"`
	Detail string `json:"detail"`
}

type GraphStats struct {
	UniqueCounterparties int     `json:"uniqueCounterparties"`
	TotalVolume          float64 `json:"totalVolume"`
	AvgTxValue           float64 `json:"avgTxValue"`
	AnalyzedTx           int     `json:"analyzedTx"`
	IncomingTx           int     `json:"incomingTx"`
	OutgoingTx           int     `json:"outgoingTx"`
	InVolume             float64 `json:"inVolume"`
	OutVolume            float64 `json:"outVolume"`
	FirstActivity        int64   `json:"firstActivity"`
	LastActivity         int64   `json:"lastActivity"`
}

type GraphResponse struct {
	Chain       string       `json:"chain"`
	Center      string       `json:"center"`
	Nodes       []GraphNode  `json:"nodes"`
	Edges       []GraphEdge  `json:"edges"`
	RiskScore   int          `json:"riskScore"`
	RiskLevel   string       `json:"riskLevel"` // low | medium | high | critical
	RiskFactors []RiskFactor `json:"riskFactors"`
	Stats       GraphStats   `json:"stats"`
	AnalyzedAt  string       `json:"analyzedAt"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func btcGraphHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")

	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if address == "" || !btcAddressRegex.MatchString(address) {
		http.Error(w, "valid btc address required", http.StatusBadRequest)
		return
	}

	maxTx := 80
	if v := r.URL.Query().Get("maxTx"); v != "" {
		if n, err := parseInt64Str(v); err == nil && n > 0 {
			maxTx = int(n)
			if maxTx > 5000 {
				maxTx = 5000
			}
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), btcAnalyzeHTTPTimeout)
	defer cancel()

	meta, err := fetchBtcSummary(ctx, address)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	want := maxTx
	if meta.NTx > 0 && want > meta.NTx {
		want = meta.NTx
	}

	views, _, err := fetchBtcTxViews(ctx, address, want)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	resp := buildBtcGraph(address, meta, views)
	writeJSON(w, resp)
}

func ethGraphHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")

	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if address == "" || !ethAddressRegex.MatchString(address) {
		http.Error(w, "valid eth address required", http.StatusBadRequest)
		return
	}

	maxTx := 80
	if v := r.URL.Query().Get("maxTx"); v != "" {
		if n, err := parseInt64Str(v); err == nil && n > 0 {
			maxTx = int(n)
			if maxTx > 5000 {
				maxTx = 5000
			}
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), ethAnalyzeHTTPTimeout)
	defer cancel()

	meta, err := fetchEthSummary(ctx, address)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	txs, _, err := paginateEthTxlist(ctx, address, maxTx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	resp := buildEthGraph(address, meta, txs)
	writeJSON(w, resp)
}

// ---------------------------------------------------------------------------
// BTC graph builder
// ---------------------------------------------------------------------------

func buildBtcGraph(center string, meta BtcSummaryResponse, txViews []BtcTxView) GraphResponse {
	type edgeKey struct{ from, to string }
	edgeMap := map[edgeKey]*GraphEdge{}
	nodeMap := map[string]*GraphNode{}

	// Центральный узел
	centerNode := &GraphNode{
		ID:          center,
		Label:       shortAddr(center),
		FullAddress: center,
		IsCenter:    true,
		Type:        "center",
		RiskScore:   0,
	}
	if meta.Balance > 0 {
		centerNode.TotalIn = meta.TotalReceived
		centerNode.TotalOut = meta.TotalSent
		centerNode.NetFlow = meta.TotalReceived - meta.TotalSent
	}
	nodeMap[center] = centerNode

	var totalVolume, inVolume, outVolume float64
	var firstActivity, lastActivity int64
	inCount, outCount := 0, 0

	for _, tx := range txViews {
		if tx.Direction == "" {
			continue
		}
		if tx.Direction == "in" {
			inCount++
			inVolume += tx.Amount
		} else {
			outCount++
			outVolume += tx.Amount
		}
		totalVolume += tx.Amount

		if firstActivity == 0 || tx.Timestamp < firstActivity {
			firstActivity = tx.Timestamp
		}
		if tx.Timestamp > lastActivity {
			lastActivity = tx.Timestamp
		}

		// Определяем контрагента
		// Приоритет: Inputs/Outputs (полные данные) → From/To (поля из кэша)
		var counterparty string
		if tx.Direction == "in" {
			for _, inp := range tx.Inputs {
				if !strings.HasPrefix(inp.Addr, "(") && inp.Addr != center {
					counterparty = inp.Addr
					break
				}
			}
			if counterparty == "" && len(tx.Inputs) > 0 {
				counterparty = tx.Inputs[0].Addr
			}
			// Fallback: поле From (хранится в кэше)
			if counterparty == "" && tx.From != "" && !strings.HasPrefix(tx.From, "(") && tx.From != center {
				counterparty = tx.From
			}
		} else {
			for _, out := range tx.Outputs {
				if !strings.HasPrefix(out.Addr, "(") && out.Addr != center {
					counterparty = out.Addr
					break
				}
			}
			if counterparty == "" && len(tx.Outputs) > 0 {
				counterparty = tx.Outputs[0].Addr
			}
			// Fallback: поле To (хранится в кэше)
			if counterparty == "" && tx.To != "" && !strings.HasPrefix(tx.To, "(") && tx.To != center {
				counterparty = tx.To
			}
		}
		if counterparty == "" || counterparty == center {
			continue
		}

		// Обновляем узел контрагента
		n, ok := nodeMap[counterparty]
		if !ok {
			n = &GraphNode{
				ID:          counterparty,
				Label:       shortAddr(counterparty),
				FullAddress: counterparty,
				IsCenter:    false,
				Type:        "counterparty",
			}
			nodeMap[counterparty] = n
		}
		n.TxCount++
		if tx.Direction == "in" {
			n.TotalOut += tx.Amount // контрагент отправил нам
		} else {
			n.TotalIn += tx.Amount // контрагент получил от нас
		}
		n.NetFlow = n.TotalIn - n.TotalOut
		if n.FirstSeen == 0 || tx.Timestamp < n.FirstSeen {
			n.FirstSeen = tx.Timestamp
		}
		if tx.Timestamp > n.LastSeen {
			n.LastSeen = tx.Timestamp
		}

		// Обновляем/создаём ребро (агрегируем по паре адресов)
		var from, to string
		if tx.Direction == "in" {
			from, to = counterparty, center
		} else {
			from, to = center, counterparty
		}
		ek := edgeKey{from, to}
		e, eok := edgeMap[ek]
		if !eok {
			e = &GraphEdge{
				ID:        fmt.Sprintf("%s->%s", from, to),
				Source:    from,
				Target:    to,
				Direction: tx.Direction,
			}
			edgeMap[ek] = e
		}
		e.Value += tx.Amount
		e.TxCount++
		if tx.Timestamp > e.Timestamp {
			e.Timestamp = tx.Timestamp
			e.Date = tx.Date
			e.Hash = tx.Hash
		}
	}

	// Обновляем centerNode
	centerNode.TxCount = meta.NTx
	centerNode.FirstSeen = firstActivity
	centerNode.LastSeen = lastActivity

	// Собираем узлы и рёбра
	nodes := make([]GraphNode, 0, len(nodeMap))
	for _, n := range nodeMap {
		nodes = append(nodes, *n)
	}
	edges := make([]GraphEdge, 0, len(edgeMap))
	for _, e := range edgeMap {
		edges = append(edges, *e)
	}

	// Сортируем для стабильного вывода
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].IsCenter {
			return true
		}
		if nodes[j].IsCenter {
			return false
		}
		return nodes[i].TxCount > nodes[j].TxCount
	})

	riskScore, riskLevel, riskFactors := calcRiskScore(center, txViews)

	// Per-node risk score (0‑100). Центр получает агрегированный риск графа,
	// каждый контрагент — собственную оценку по объёму, частоте, асимметрии
	// и dust-паттерну, чтобы узлы получали разные оттенки в визуализации.
	for i := range nodes {
		if nodes[i].IsCenter {
			nodes[i].RiskScore = riskScore
			nodes[i].RiskLevel = riskLevel
			continue
		}
		nodes[i].RiskScore, nodes[i].RiskLevel = perNodeRisk(&nodes[i])
	}

	stats := GraphStats{
		UniqueCounterparties: len(nodeMap) - 1,
		TotalVolume:          roundTo(totalVolume, 6),
		InVolume:             roundTo(inVolume, 6),
		OutVolume:            roundTo(outVolume, 6),
		AnalyzedTx:           len(txViews),
		IncomingTx:           inCount,
		OutgoingTx:           outCount,
		FirstActivity:        firstActivity,
		LastActivity:         lastActivity,
	}
	if len(txViews) > 0 {
		stats.AvgTxValue = roundTo(totalVolume/float64(len(txViews)), 6)
	}

	return GraphResponse{
		Chain:       "bitcoin",
		Center:      center,
		Nodes:       nodes,
		Edges:       edges,
		RiskScore:   riskScore,
		RiskLevel:   riskLevel,
		RiskFactors: riskFactors,
		Stats:       stats,
		AnalyzedAt:  time.Now().UTC().Format(time.RFC3339),
	}
}

// ---------------------------------------------------------------------------
// ETH graph builder
// ---------------------------------------------------------------------------

func buildEthGraph(center string, meta EthSummaryResponse, txs []ethRawTx) GraphResponse {
	type edgeKey struct{ from, to string }
	edgeMap := map[edgeKey]*GraphEdge{}
	nodeMap := map[string]*GraphNode{}
	cl := strings.ToLower(strings.TrimSpace(center))

	centerNode := &GraphNode{
		ID:          center,
		Label:       shortAddr(center),
		FullAddress: center,
		IsCenter:    true,
		Type:        "center",
		TxCount:     meta.NTx,
	}
	nodeMap[center] = centerNode

	var totalVolume, inVolume, outVolume float64
	var firstActivity, lastActivity int64
	inCount, outCount := 0, 0

	for _, tx := range txs {
		fromL := strings.ToLower(strings.TrimSpace(tx.From))
		toL := strings.ToLower(strings.TrimSpace(tx.To))
		val := weiToEth(tx.Value)
		ts := parseInt64(tx.TimeStamp)

		if ts == 0 {
			continue
		}
		if firstActivity == 0 || ts < firstActivity {
			firstActivity = ts
		}
		if ts > lastActivity {
			lastActivity = ts
		}

		var direction string
		var counterparty string

		if fromL == cl {
			direction = "out"
			counterparty = tx.To
			outCount++
			outVolume += val
		} else if toL == cl {
			direction = "in"
			counterparty = tx.From
			inCount++
			inVolume += val
		} else {
			continue
		}
		if counterparty == "" || strings.EqualFold(counterparty, center) {
			continue
		}

		totalVolume += val

		n, ok := nodeMap[counterparty]
		if !ok {
			n = &GraphNode{
				ID:          counterparty,
				Label:       shortAddr(counterparty),
				FullAddress: counterparty,
				Type:        "counterparty",
			}
			nodeMap[counterparty] = n
		}
		n.TxCount++
		if direction == "in" {
			n.TotalOut += val
		} else {
			n.TotalIn += val
		}
		n.NetFlow = n.TotalIn - n.TotalOut
		if n.FirstSeen == 0 || ts < n.FirstSeen {
			n.FirstSeen = ts
		}
		if ts > n.LastSeen {
			n.LastSeen = ts
		}

		var from, to string
		if direction == "out" {
			from, to = center, counterparty
		} else {
			from, to = counterparty, center
		}
		ek := edgeKey{from, to}
		e, eok := edgeMap[ek]
		if !eok {
			e = &GraphEdge{
				ID:        fmt.Sprintf("%s->%s", from, to),
				Source:    from,
				Target:    to,
				Direction: direction,
			}
			edgeMap[ek] = e
		}
		e.Value += val
		e.TxCount++
		if ts > e.Timestamp {
			e.Timestamp = ts
			e.Date = time.Unix(ts, 0).UTC().Format(time.RFC3339)
			e.Hash = tx.Hash
		}
	}

	centerNode.FirstSeen = firstActivity
	centerNode.LastSeen = lastActivity

	// Build mock BtcTxViews для risk scorer (упрощённо по ETH)
	mockViews := make([]BtcTxView, 0, len(txs))
	for _, tx := range txs {
		val := weiToEth(tx.Value)
		ts := parseInt64(tx.TimeStamp)
		dir := ""
		if strings.EqualFold(tx.From, center) {
			dir = "out"
		} else if strings.EqualFold(tx.To, center) {
			dir = "in"
		}
		if dir == "" || ts == 0 {
			continue
		}
		mockViews = append(mockViews, BtcTxView{
			Hash:      tx.Hash,
			Timestamp: ts,
			Direction: dir,
			Amount:    val,
			From:      tx.From,
			To:        tx.To,
		})
	}

	riskScore, riskLevel, riskFactors := calcRiskScore(center, mockViews)

	nodes := make([]GraphNode, 0, len(nodeMap))
	for _, n := range nodeMap {
		nodes = append(nodes, *n)
	}
	edges := make([]GraphEdge, 0, len(edgeMap))
	for _, e := range edgeMap {
		edges = append(edges, *e)
	}

	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].IsCenter {
			return true
		}
		if nodes[j].IsCenter {
			return false
		}
		return nodes[i].TxCount > nodes[j].TxCount
	})

	for i := range nodes {
		if nodes[i].IsCenter {
			nodes[i].RiskScore = riskScore
			nodes[i].RiskLevel = riskLevel
			continue
		}
		nodes[i].RiskScore, nodes[i].RiskLevel = perNodeRisk(&nodes[i])
	}

	stats := GraphStats{
		UniqueCounterparties: len(nodeMap) - 1,
		TotalVolume:          roundTo(totalVolume, 8),
		InVolume:             roundTo(inVolume, 8),
		OutVolume:            roundTo(outVolume, 8),
		AnalyzedTx:           len(txs),
		IncomingTx:           inCount,
		OutgoingTx:           outCount,
		FirstActivity:        firstActivity,
		LastActivity:         lastActivity,
	}
	if len(txs) > 0 {
		stats.AvgTxValue = roundTo(totalVolume/float64(len(txs)), 8)
	}

	return GraphResponse{
		Chain:       "ethereum",
		Center:      center,
		Nodes:       nodes,
		Edges:       edges,
		RiskScore:   riskScore,
		RiskLevel:   riskLevel,
		RiskFactors: riskFactors,
		Stats:       stats,
		AnalyzedAt:  time.Now().UTC().Format(time.RFC3339),
	}
}

// ---------------------------------------------------------------------------
// Risk Score (rule-based)
// ---------------------------------------------------------------------------

func calcRiskScore(center string, txViews []BtcTxView) (int, string, []RiskFactor) {
	if len(txViews) == 0 {
		return 0, "low", nil
	}

	score := 0
	var factors []RiskFactor

	sorted := make([]BtcTxView, len(txViews))
	copy(sorted, txViews)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Timestamp < sorted[j].Timestamp
	})

	// 1. Fan-out — транзакция с множеством выходов (признак миксера)
	maxOut := 0
	for _, tx := range txViews {
		if len(tx.Outputs) > maxOut {
			maxOut = len(tx.Outputs)
		}
	}
	if maxOut >= 10 {
		add := 30
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Fan-out паттерн",
			Score:  add,
			Detail: fmt.Sprintf("Обнаружена транзакция с %d выходами — классический признак миксера или coinjoin", maxOut),
		})
	} else if maxOut >= 5 {
		add := 12
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Множественные выходы",
			Score:  add,
			Detail: fmt.Sprintf("Транзакция с %d выходами", maxOut),
		})
	}

	// 2. Rapid transactions — ≥5 транзакций в течение 1 часа
	maxInHour := 0
	for i := range sorted {
		cnt := 1
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Timestamp-sorted[i].Timestamp <= 3600 {
				cnt++
			} else {
				break
			}
		}
		if cnt > maxInHour {
			maxInHour = cnt
		}
	}
	if maxInHour >= 10 {
		add := 20
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Частые транзакции",
			Score:  add,
			Detail: fmt.Sprintf("%d транзакций в течение 1 часа — нетипичная автоматическая активность", maxInHour),
		})
	} else if maxInHour >= 5 {
		add := 10
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Повышенная частота",
			Score:  add,
			Detail: fmt.Sprintf("%d транзакций за 1 час", maxInHour),
		})
	}

	// 3. Высокое разнообразие контрагентов
	counterparties := map[string]struct{}{}
	for _, tx := range txViews {
		if tx.Direction == "in" {
			for _, inp := range tx.Inputs {
				if !strings.HasPrefix(inp.Addr, "(") && inp.Addr != center {
					counterparties[inp.Addr] = struct{}{}
				}
			}
		} else {
			for _, out := range tx.Outputs {
				if !strings.HasPrefix(out.Addr, "(") && out.Addr != center {
					counterparties[out.Addr] = struct{}{}
				}
			}
		}
	}
	if len(txViews) >= 10 {
		ratio := float64(len(counterparties)) / float64(len(txViews))
		if ratio >= 0.9 {
			add := 15
			score += add
			factors = append(factors, RiskFactor{
				Name:   "Высокое разнообразие контрагентов",
				Score:  add,
				Detail: fmt.Sprintf("%.0f%% уникальных адресов от числа транзакций — признак миксера", ratio*100),
			})
		} else if ratio >= 0.75 {
			add := 8
			score += add
			factors = append(factors, RiskFactor{
				Name:   "Много уникальных адресов",
				Score:  add,
				Detail: fmt.Sprintf("%.0f%% уникальных контрагентов", ratio*100),
			})
		}
	}

	// 4. Круглые суммы (>= 50%)
	roundCnt := 0
	for _, tx := range txViews {
		if tx.Amount > 0 {
			scaled := tx.Amount * 1000
			if math.Abs(scaled-math.Round(scaled)) < 0.001 {
				roundCnt++
			}
		}
	}
	if len(txViews) > 0 {
		roundRatio := float64(roundCnt) / float64(len(txViews))
		if roundRatio >= 0.5 {
			add := 10
			score += add
			factors = append(factors, RiskFactor{
				Name:   "Круглые суммы",
				Score:  add,
				Detail: fmt.Sprintf("%.0f%% транзакций с round-number суммами — характерно для автоматических переводов", roundRatio*100),
			})
		}
	}

	// 5. Реактивация после долгого перерыва
	if len(sorted) >= 2 {
		maxGap := int64(0)
		for i := 1; i < len(sorted); i++ {
			g := sorted[i].Timestamp - sorted[i-1].Timestamp
			if g > maxGap {
				maxGap = g
			}
		}
		days := maxGap / 86400
		if days >= 365 {
			add := 12
			score += add
			factors = append(factors, RiskFactor{
				Name:   "Реактивация после спячки",
				Score:  add,
				Detail: fmt.Sprintf("Кошелёк был неактивен %d дней, затем внезапная активность — признак «пробудившегося» адреса", days),
			})
		} else if days >= 180 {
			add := 5
			score += add
			factors = append(factors, RiskFactor{
				Name:   "Долгий перерыв",
				Score:  add,
				Detail: fmt.Sprintf("Перерыв в активности %d дней", days),
			})
		}
	}

	// 6. Очень мелкие суммы (dust attack)
	dustCnt := 0
	for _, tx := range txViews {
		if tx.Amount > 0 && tx.Amount < 0.0001 {
			dustCnt++
		}
	}
	if len(txViews) > 0 {
		dustRatio := float64(dustCnt) / float64(len(txViews))
		if dustRatio >= 0.3 {
			add := 8
			score += add
			factors = append(factors, RiskFactor{
				Name:   "Пыльные транзакции",
				Score:  add,
				Detail: fmt.Sprintf("%.0f%% транзакций < 0.0001 BTC — возможная dust attack для деанонимизации", dustRatio*100),
			})
		}
	}

	// 7. Крупные единичные транзакции
	maxSingle := 0.0
	for _, tx := range txViews {
		if tx.Amount > maxSingle {
			maxSingle = tx.Amount
		}
	}
	if maxSingle >= 100 {
		add := 20
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Крупные транзакции",
			Score:  add,
			Detail: fmt.Sprintf("Максимальная сумма транзакции %.2f BTC — крупный оборот, характерен для бирж и сервисов микширования", maxSingle),
		})
	} else if maxSingle >= 10 {
		add := 10
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Значительные суммы",
			Score:  add,
			Detail: fmt.Sprintf("Транзакции до %.2f BTC — нетипичный для рядового пользователя объём", maxSingle),
		})
	}

	// 8. Высокий общий оборот
	var totalVol float64
	for _, tx := range txViews {
		totalVol += tx.Amount
	}
	if totalVol >= 1000 {
		add := 15
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Сверхвысокий оборот",
			Score:  add,
			Detail: fmt.Sprintf("Суммарный оборот %.2f BTC — уровень биржи или крупного сервиса", totalVol),
		})
	} else if totalVol >= 100 {
		add := 8
		score += add
		factors = append(factors, RiskFactor{
			Name:   "Высокий оборот",
			Score:  add,
			Detail: fmt.Sprintf("Суммарный оборот %.2f BTC за выборку", totalVol),
		})
	}

	// 9. Асимметрия входящих/исходящих (транзитный узел)
	if len(txViews) >= 10 {
		inVol, outVol := 0.0, 0.0
		for _, tx := range txViews {
			if tx.Direction == "in" {
				inVol += tx.Amount
			} else {
				outVol += tx.Amount
			}
		}
		if inVol > 0 && outVol > 0 {
			ratio := inVol / outVol
			if ratio < 1 {
				ratio = 1 / ratio
			}
			if ratio >= 0.95 && ratio <= 1.05 {
				add := 12
				score += add
				factors = append(factors, RiskFactor{
					Name:   "Транзитный паттерн",
					Score:  add,
					Detail: fmt.Sprintf("Входящий и исходящий объём практически равны (%.1f%%/%.1f%%) — признак пересылочного кошелька", inVol/(inVol+outVol)*100, outVol/(inVol+outVol)*100),
				})
			}
		}
	}

	if score > 100 {
		score = 100
	}

	level := "low"
	switch {
	case score >= 70:
		level = "critical"
	case score >= 45:
		level = "high"
	case score >= 20:
		level = "medium"
	}

	return score, level, factors
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// shortAddr возвращает сокращённый адрес вида "bc1q…ab3f"
func shortAddr(addr string) string {
	if len(addr) <= 12 {
		return addr
	}
	return addr[:6] + "…" + addr[len(addr)-4:]
}

func parseInt64Str(s string) (int64, error) {
	var v int64
	_, err := fmt.Sscan(s, &v)
	return v, err
}

// perNodeRisk — индивидуальный риск контрагента 0–100 + метка (badge).
//
// Пороги nodeColor на фронте: ≥70=red, ≥45=orange, ≥15=yellow, <15=green.
// Пороги levelFromScore: low<15 | medium 15–44 | high 45–69 | critical ≥70
//
// Badges (метки):
//   TRANSIT  — почти идеальный баланс in/out, объём значительный
//   MIXER    — сотни TX + идеальный транзит (миксер / coinjoin)
//   DUST     — много мелких TX (dust attack)
//   HIGH-VOL — очень крупный объём при малом числе TX
//   FREQUENT — очень высокая частота TX
func perNodeRisk(n *GraphNode) (int, string) {
	vol := n.TotalIn + n.TotalOut

	// ── Объём (0–30) ─────────────────────────────────────────────────────────
	volScore := 0
	switch {
	case vol >= 1000:
		volScore = 30
	case vol >= 100:
		volScore = 22
	case vol >= 10:
		volScore = 15
	case vol >= 1:
		volScore = 8
	case vol >= 0.01:
		volScore = 3
	}

	// ── Частота (0–38) ───────────────────────────────────────────────────────
	txScore := 0
	switch {
	case n.TxCount >= 100:
		txScore = 38
	case n.TxCount >= 50:
		txScore = 28
	case n.TxCount >= 20:
		txScore = 20
	case n.TxCount >= 10:
		txScore = 12
	case n.TxCount >= 5:
		txScore = 6
	case n.TxCount >= 2:
		txScore = 3
	case n.TxCount >= 1:
		txScore = 1
	}

	score := float64(volScore + txScore)
	badge := ""

	// ── Транзитный паттерн ───────────────────────────────────────────────────
	isTransit := false
	if n.TotalIn > 0 && n.TotalOut > 0 && vol >= 2 {
		ratio := n.TotalIn / n.TotalOut
		if ratio < 1 {
			ratio = 1 / ratio
		}
		if ratio <= 1.05 {
			if n.TxCount >= 50 {
				score += 30
				badge = "MIXER"
				isTransit = true
			} else {
				score += 20
				badge = "TRANSIT"
				isTransit = true
			}
		} else if ratio <= 1.20 && vol >= 10 {
			score += 12
			badge = "TRANSIT"
			isTransit = true
		}
	}

	// ── Dust attack ──────────────────────────────────────────────────────────
	if n.TxCount >= 5 && vol < 0.001 {
		score += 25
		badge = "DUST"
	}

	// ── Дополнительные метки (если badge ещё не выставлен) ──────────────────
	if badge == "" {
		if vol >= 100 && n.TxCount < 10 {
			badge = "HIGH-VOL"
		} else if n.TxCount >= 50 && !isTransit {
			badge = "FREQUENT"
		}
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	final := int(math.Round(score))
	n.Badge = badge
	return final, levelFromScore(final)
}

func levelFromScore(s int) string {
	switch {
	case s >= 70:
		return "critical"
	case s >= 45:
		return "high"
	case s >= 15:
		return "medium"
	default:
		return "low"
	}
}
