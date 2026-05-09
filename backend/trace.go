package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── Bitcoin trace: построение полного пути перемещения средств ─────────────
//
// Идея:
//   • На входе — txid интересующей нас транзакции (опционально — индекс vout).
//   • Назад: для каждого vin спускаемся к prev_tx → его vin → ... до coinbase
//     или достижения maxDepth.
//   • Вперёд: для каждого vout проверяем, потрачен ли он (outspend) →
//     спускаемся к следующему tx → к его outspends → ... до конца цепи.
//
// API:
//   GET /api/btc/trace?hash=<txid>&depth=5&direction=both|forward|backward
//
//   depth     — на сколько шагов в каждую сторону (1-8, default 5)
//   direction — both / forward / backward / forward (default both)

// ─── Структуры ответа ────────────────────────────────────────────────────────

type TraceResponse struct {
	Chain string       `json:"chain"`
	Root  string       `json:"root"`  // tx, который запросил пользователь
	Nodes []TraceNode  `json:"nodes"` // транзакции
	Edges []TraceEdge  `json:"edges"` // переходы output → input next-tx
	Stats TraceStats   `json:"stats"`
	Meta  TraceMeta    `json:"meta"`
}

type TraceNode struct {
	Hash        string    `json:"hash"`
	Depth       int       `json:"depth"`     // 0 = root, отрицательные = назад, положительные = вперёд
	Time        int64     `json:"time"`
	Confirmed   bool      `json:"confirmed"`
	BlockHeight int       `json:"blockHeight"`
	Fee         float64   `json:"fee"`
	Inputs      []TraceIO `json:"inputs"`
	Outputs     []TraceIO `json:"outputs"`
	TotalIn     float64   `json:"totalIn"`
	TotalOut    float64   `json:"totalOut"`
	IsCoinbase  bool      `json:"isCoinbase,omitempty"`
	IsRoot      bool      `json:"isRoot,omitempty"`
	ExplorerURL string    `json:"explorerUrl"`
}

type TraceIO struct {
	Index    int     `json:"index"`
	Addr     string  `json:"addr"`
	Value    float64 `json:"value"`
	// для outputs: куда они дальше ушли (если spent)
	SpentBy  string  `json:"spentBy,omitempty"`
	SpentVin int     `json:"spentVin,omitempty"`
	Spent    bool    `json:"spent,omitempty"`
	// для inputs: откуда пришли
	PrevTxid string  `json:"prevTxid,omitempty"`
	PrevVout int     `json:"prevVout,omitempty"`
}

type TraceEdge struct {
	From      string  `json:"from"`     // tx hash, выход которого тратится
	FromVout  int     `json:"fromVout"` // индекс выхода
	To        string  `json:"to"`       // tx hash, который тратит этот выход
	ToVin     int     `json:"toVin"`    // индекс входа в принимающей tx
	Address   string  `json:"address"`  // адрес-владелец выхода
	Value     float64 `json:"value"`
}

type TraceStats struct {
	Backward      int     `json:"backward"`
	Forward       int     `json:"forward"`
	TotalNodes    int     `json:"totalNodes"`
	TotalEdges    int     `json:"totalEdges"`
	TotalValue    float64 `json:"totalValue"`
	UniqueAddrs   int     `json:"uniqueAddrs"`
	OldestTime    int64   `json:"oldestTime"`
	NewestTime    int64   `json:"newestTime"`
}

type TraceMeta struct {
	Direction string `json:"direction"`
	Depth     int    `json:"depth"`
	Truncated bool   `json:"truncated"` // достигли лимита по глубине/нодам
	Cached    bool   `json:"cached,omitempty"`
	CacheAgeS int64  `json:"cacheAgeS,omitempty"`
}

// ─── Внутренние модели для mempool.space ────────────────────────────────────

type mempoolTraceTx = mempoolTx

// outspendInfo описывает результат /api/tx/{txid}/outspend/{idx}
// или элемент массива из /api/tx/{txid}/outspends.
type outspendInfo struct {
	Spent  bool   `json:"spent"`
	Txid   string `json:"txid,omitempty"`
	Vin    int    `json:"vin,omitempty"`
	Status mempoolStatus `json:"status,omitempty"`
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

const (
	traceMaxDepth         = 8
	traceMaxNodesPerDir   = 220 // отдельно назад и вперёд; хватит на глубину 5 при широком root
	traceTimeout          = 90 * time.Second
	traceCacheTTL         = 10 * time.Minute
)

func btcTraceHandler(w http.ResponseWriter, r *http.Request) {
	hash := strings.TrimSpace(r.URL.Query().Get("hash"))
	if hash == "" {
		http.Error(w, "missing hash", http.StatusBadRequest)
		return
	}
	depth, _ := strconv.Atoi(r.URL.Query().Get("depth"))
	if depth <= 0 {
		depth = 5
	}
	if depth > traceMaxDepth {
		depth = traceMaxDepth
	}

	dir := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("direction")))
	if dir == "" {
		dir = "both"
	}
	wantBack := dir == "both" || dir == "backward"
	wantFwd := dir == "both" || dir == "forward"

	ctx, cancel := context.WithTimeout(r.Context(), traceTimeout)
	defer cancel()

	if cached, ok := traceCacheGet(hash, depth, dir); ok {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(cached)
		return
	}

	resp, err := traceBitcoin(ctx, hash, depth, wantBack, wantFwd)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	traceCachePut(hash, depth, dir, resp)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func traceCacheKey(root string, depth int, dir string) string {
	return fmt.Sprintf("btc|%s|%d|%s", root, depth, dir)
}

func traceCacheGet(root string, depth int, dir string) (TraceResponse, bool) {
	if globalDB == nil {
		return TraceResponse{}, false
	}
	key := traceCacheKey(root, depth, dir)
	var payload string
	var createdAt int64
	row := globalDB.QueryRow(
		`SELECT payload_json, created_at FROM trace_cache WHERE cache_key=?`,
		key,
	)
	if err := row.Scan(&payload, &createdAt); err != nil {
		return TraceResponse{}, false
	}
	age := time.Now().Unix() - createdAt
	if age < 0 || age > int64(traceCacheTTL/time.Second) {
		return TraceResponse{}, false
	}
	var resp TraceResponse
	if err := json.Unmarshal([]byte(payload), &resp); err != nil {
		return TraceResponse{}, false
	}
	resp.Meta.Cached = true
	resp.Meta.CacheAgeS = age
	_, _ = globalDB.Exec(
		`UPDATE trace_cache SET last_hit=?, hits=hits+1 WHERE cache_key=?`,
		time.Now().Unix(), key,
	)
	return resp, true
}

func traceCachePut(root string, depth int, dir string, resp TraceResponse) {
	if globalDB == nil {
		return
	}
	// В кэш пишем "чистый" ответ (без cached-флагов).
	resp.Meta.Cached = false
	resp.Meta.CacheAgeS = 0
	b, err := json.Marshal(resp)
	if err != nil {
		return
	}
	now := time.Now().Unix()
	key := traceCacheKey(root, depth, dir)
	_, _ = globalDB.Exec(
		`INSERT INTO trace_cache(cache_key, chain, root_hash, depth, direction, payload_json, created_at, last_hit, hits)
		 VALUES(?,?,?,?,?,?,?,?,1)
		 ON CONFLICT(cache_key) DO UPDATE SET
		   payload_json=excluded.payload_json,
		   created_at=excluded.created_at,
		   last_hit=excluded.last_hit,
		   hits=trace_cache.hits+1`,
		key, "bitcoin", root, depth, dir, string(b), now, now,
	)
}

// ─── Основная логика трассировки ─────────────────────────────────────────────

// tracer — общий стейт обхода. Реализован через мьютекс, поскольку обход
// идёт BFS-волнами, и параллельные походы за разными txid безопасно
// заполняют общий nodeMap/edgeMap.
//
// Лимиты считаются ОТДЕЛЬНО для backward и forward: иначе при глубокой
// «нисходящей» цепочке весь бюджет уходит в одну сторону.
type tracer struct {
	mu        sync.Mutex
	nodes     map[string]*TraceNode
	edges     map[string]*TraceEdge // ключ = from|fromVout|to
	addrs     map[string]struct{}
	backCount int
	fwdCount  int
	dirLimit  int

	// Принудительное обрезание: новый узел загружен по сети и положен в граф,
	// но дальнейшее углубление по нему уже запрещено бюджетом explore.
	truncBack bool
	truncFwd  bool
}

func newTracer(perDirLimit int) *tracer {
	return &tracer{
		nodes:    map[string]*TraceNode{},
		edges:    map[string]*TraceEdge{},
		addrs:    map[string]struct{}{},
		dirLimit: perDirLimit,
	}
}

func (t *tracer) hasNode(hash string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	_, ok := t.nodes[hash]
	return ok
}

func (t *tracer) backFull() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.backCount >= t.dirLimit
}

func (t *tracer) fwdFull() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.fwdCount >= t.dirLimit
}

// registerBackwardNode сохраняет узел трассировки «назад» после fetch.
//
// Если txid уже в графе — только подправляем Depth (ближе к root) и возвращаем без рекурсии.
// Если лимит backCount уже исчерпан — всё равно сохраняем полную ноду (рёбра и UI иначе
// расходятся: сумма по шагу −2 падает до «0.8 BTC» из‑за missing node у фронта).
// В этом случае recurse=false и truncBack=true — дальнейший обход входов этого tx не выполняется.
func (t *tracer) registerBackwardNode(n *TraceNode) (recurse bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if ex, ok := t.nodes[n.Hash]; ok {
		if abs(n.Depth) < abs(ex.Depth) {
			ex.Depth = n.Depth
		}
		return false
	}
	put := func(node *TraceNode) {
		t.nodes[node.Hash] = node
		for _, in := range node.Inputs {
			if in.Addr != "" {
				t.addrs[in.Addr] = struct{}{}
			}
		}
		for _, out := range node.Outputs {
			if out.Addr != "" {
				t.addrs[out.Addr] = struct{}{}
			}
		}
	}
	if t.backCount >= t.dirLimit {
		put(n)
		t.truncBack = true
		return false
	}
	t.backCount++
	put(n)
	return true
}

// registerForwardNode — то же для направления «вперёд».
func (t *tracer) registerForwardNode(n *TraceNode) (recurse bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if ex, ok := t.nodes[n.Hash]; ok {
		if abs(n.Depth) < abs(ex.Depth) {
			ex.Depth = n.Depth
		}
		return false
	}
	put := func(node *TraceNode) {
		t.nodes[node.Hash] = node
		for _, in := range node.Inputs {
			if in.Addr != "" {
				t.addrs[in.Addr] = struct{}{}
			}
		}
		for _, out := range node.Outputs {
			if out.Addr != "" {
				t.addrs[out.Addr] = struct{}{}
			}
		}
	}
	if t.fwdCount >= t.dirLimit {
		put(n)
		t.truncFwd = true
		return false
	}
	t.fwdCount++
	put(n)
	return true
}

// addRoot — отдельная функция для root-ноды (без лимитной проверки).
func (t *tracer) addRoot(n *TraceNode) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.nodes[n.Hash] = n
	for _, in := range n.Inputs {
		if in.Addr != "" {
			t.addrs[in.Addr] = struct{}{}
		}
	}
	for _, out := range n.Outputs {
		if out.Addr != "" {
			t.addrs[out.Addr] = struct{}{}
		}
	}
}

func (t *tracer) addEdge(e TraceEdge) {
	key := fmt.Sprintf("%s|%d|%s", e.From, e.FromVout, e.To)
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.edges[key]; ok {
		return
	}
	cp := e
	t.edges[key] = &cp
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func traceBitcoin(ctx context.Context, root string, maxDepth int, wantBack, wantFwd bool) (TraceResponse, error) {
	tr := newTracer(traceMaxNodesPerDir)

	rootTx, err := fetchMempoolTx(ctx, root)
	if err != nil {
		return TraceResponse{}, fmt.Errorf("fetch root tx: %w", err)
	}
	rootNode := txToTraceNode(rootTx, 0)
	rootNode.IsRoot = true
	tr.addRoot(rootNode)

	// Запускаем оба направления ПАРАЛЛЕЛЬНО — иначе forward может
	// «не успеть», если backward целиком выберет общий бюджет узлов.
	var wg sync.WaitGroup
	var backErr, fwdErr error
	if wantBack {
		wg.Add(1)
		go func() {
			defer wg.Done()
			backErr = traceBackward(ctx, tr, rootTx, 1, maxDepth)
		}()
	}
	if wantFwd {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fwdErr = traceForward(ctx, tr, rootTx, 1, maxDepth)
		}()
	}
	wg.Wait()

	truncated := backErr != nil || fwdErr != nil || tr.truncBack || tr.truncFwd

	// Сборка ответа
	nodes := make([]TraceNode, 0, len(tr.nodes))
	var oldest, newest int64 = 0, 0
	var totalValue float64
	for _, n := range tr.nodes {
		nodes = append(nodes, *n)
		if n.Time > 0 {
			if oldest == 0 || n.Time < oldest {
				oldest = n.Time
			}
			if n.Time > newest {
				newest = n.Time
			}
		}
		totalValue += n.TotalOut
	}
	edges := make([]TraceEdge, 0, len(tr.edges))
	for _, e := range tr.edges {
		edges = append(edges, *e)
	}

	// Подсчёт глубин
	var back, fwd int
	for _, n := range tr.nodes {
		if n.Depth < 0 {
			back++
		} else if n.Depth > 0 {
			fwd++
		}
	}

	return TraceResponse{
		Chain: "bitcoin",
		Root:  root,
		Nodes: nodes,
		Edges: edges,
		Stats: TraceStats{
			Backward:    back,
			Forward:     fwd,
			TotalNodes:  len(nodes),
			TotalEdges:  len(edges),
			TotalValue:  roundTo(totalValue, 8),
			UniqueAddrs: len(tr.addrs),
			OldestTime:  oldest,
			NewestTime:  newest,
		},
		Meta: TraceMeta{
			Direction: directionName(wantBack, wantFwd),
			Depth:     maxDepth,
			Truncated: truncated,
		},
	}, nil
}

func directionName(back, fwd bool) string {
	switch {
	case back && fwd:
		return "both"
	case back:
		return "backward"
	case fwd:
		return "forward"
	default:
		return "none"
	}
}

// traceBackward — рекурсивно идём от tx к её prev_tx по каждому vin.
// ВАЖНО: рекурсия в более глубокие уровни выполняется только ПОСЛЕ того,
// как для текущей tx обработаны все vin и отложены родительские транзакции.
// Иначе параллельные goroutine успевают «съесть» лимит узлов чужими ветками,
// пока мы ещё не подтянули часть входов текущего уровня (типичный кейс —
// ROOT с 10 входами, а видны только первые ~4 родителей).
//
// Ребро к текущей tx записываем всегда, если удалось загрузить prev_tx,
// даже если лимит не дал сохранить полный узел — чтобы суммы «к ROOT»
// на первом шаге совпадали с суммой реальных входов.
func traceBackward(ctx context.Context, tr *tracer, tx mempoolTraceTx, depth, maxDepth int) error {
	if depth > maxDepth {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}

	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex

	var childrenMu sync.Mutex
	seenChild := make(map[string]struct{})
	var children []mempoolTraceTx

	for vinIdx, vin := range tx.Vin {
		if vin.IsCoinbase || vin.Txid == "" {
			continue
		}

		// Если бюджет узлов назад уже исчерпан, не делаем новые сетевые fetch:
		// записываем только ребро (значение известно из vin.prevout) и помечаем truncation.
		if tr.backFull() && !tr.hasNode(vin.Txid) {
			tr.addEdge(TraceEdge{
				From:     vin.Txid,
				FromVout: vin.Vout,
				To:       tx.Txid,
				ToVin:    vinIdx,
				Address:  vin.Prevout.ScriptpubkeyAddress,
				Value:    satoshiToCoin(vin.Prevout.Value),
			})
			tr.mu.Lock()
			tr.truncBack = true
			tr.mu.Unlock()
			continue
		}

		// Уже есть нода — фиксируем ребро и пропускаем
		if tr.hasNode(vin.Txid) {
			tr.addEdge(TraceEdge{
				From:     vin.Txid,
				FromVout: vin.Vout,
				To:       tx.Txid,
				ToVin:    vinIdx,
				Address:  vin.Prevout.ScriptpubkeyAddress,
				Value:    satoshiToCoin(vin.Prevout.Value),
			})
			continue
		}

		wg.Add(1)
		sem <- struct{}{}
		go func(prevTxid string, prevVout int, vinIdx int, vinAddr string, vinValue int64) {
			defer wg.Done()
			defer func() { <-sem }()

			prev, err := fetchMempoolTx(ctx, prevTxid)
			if err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				errMu.Unlock()
				return
			}
			tr.addEdge(TraceEdge{
				From:     prevTxid,
				FromVout: prevVout,
				To:       tx.Txid,
				ToVin:    vinIdx,
				Address:  vinAddr,
				Value:    satoshiToCoin(vinValue),
			})
			node := txToTraceNode(prev, -depth)
			if tr.registerBackwardNode(node) {
				childrenMu.Lock()
				if _, dup := seenChild[prevTxid]; !dup {
					seenChild[prevTxid] = struct{}{}
					children = append(children, prev)
				}
				childrenMu.Unlock()
			}
		}(vin.Txid, vin.Vout, vinIdx, vin.Prevout.ScriptpubkeyAddress, vin.Prevout.Value)
	}
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	for _, prev := range children {
		if err := traceBackward(ctx, tr, prev, depth+1, maxDepth); err != nil {
			return err
		}
	}
	return nil
}

// traceForward — для каждого vout проверяем outspend и идём в next-tx.
func traceForward(ctx context.Context, tr *tracer, tx mempoolTraceTx, depth, maxDepth int) error {
	if depth > maxDepth {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}

	spends, err := fetchMempoolOutspends(ctx, tx.Txid)
	if err != nil {
		return err
	}

	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex

	var childrenMu sync.Mutex
	seenChild := make(map[string]struct{})
	var children []mempoolTraceTx

	for outIdx, sp := range spends {
		if !sp.Spent || sp.Txid == "" {
			continue
		}

		voutAddr := ""
		voutValue := int64(0)
		if outIdx < len(tx.Vout) {
			voutAddr = tx.Vout[outIdx].ScriptpubkeyAddress
			voutValue = tx.Vout[outIdx].Value
		}
		// Аналогично backward: при исчерпанном бюджете вперёд не грузим новые tx,
		// чтобы не взрывать объём данных и не вешать UI.
		if tr.fwdFull() && !tr.hasNode(sp.Txid) {
			tr.addEdge(TraceEdge{
				From:     tx.Txid,
				FromVout: outIdx,
				To:       sp.Txid,
				ToVin:    sp.Vin,
				Address:  voutAddr,
				Value:    satoshiToCoin(voutValue),
			})
			tr.mu.Lock()
			tr.truncFwd = true
			tr.mu.Unlock()
			continue
		}

		if tr.hasNode(sp.Txid) {
			tr.addEdge(TraceEdge{
				From:     tx.Txid,
				FromVout: outIdx,
				To:       sp.Txid,
				ToVin:    sp.Vin,
				Address:  voutAddr,
				Value:    satoshiToCoin(voutValue),
			})
			continue
		}

		wg.Add(1)
		sem <- struct{}{}
		go func(nextTxid string, voutIdx int, vinIdx int, addr string, value int64) {
			defer wg.Done()
			defer func() { <-sem }()

			next, err := fetchMempoolTx(ctx, nextTxid)
			if err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				errMu.Unlock()
				return
			}
			tr.addEdge(TraceEdge{
				From:     tx.Txid,
				FromVout: voutIdx,
				To:       nextTxid,
				ToVin:    vinIdx,
				Address:  addr,
				Value:    satoshiToCoin(value),
			})
			node := txToTraceNode(next, depth)
			if tr.registerForwardNode(node) {
				childrenMu.Lock()
				if _, dup := seenChild[nextTxid]; !dup {
					seenChild[nextTxid] = struct{}{}
					children = append(children, next)
				}
				childrenMu.Unlock()
			}
		}(sp.Txid, outIdx, sp.Vin, voutAddr, voutValue)
	}
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	for _, next := range children {
		if err := traceForward(ctx, tr, next, depth+1, maxDepth); err != nil {
			return err
		}
	}
	return nil
}

// ─── Конвертация tx → trace-node ─────────────────────────────────────────────

func txToTraceNode(tx mempoolTraceTx, depth int) *TraceNode {
	n := &TraceNode{
		Hash:        tx.Txid,
		Depth:       depth,
		Time:        tx.Status.BlockTime,
		Confirmed:   tx.Status.Confirmed,
		BlockHeight: tx.Status.BlockHeight,
		Fee:         satoshiToCoin(tx.Fee),
		ExplorerURL: "https://mempool.space/tx/" + tx.Txid,
	}

	for i, vin := range tx.Vin {
		if vin.IsCoinbase {
			n.IsCoinbase = true
			continue
		}
		n.Inputs = append(n.Inputs, TraceIO{
			Index:    i,
			Addr:     vin.Prevout.ScriptpubkeyAddress,
			Value:    satoshiToCoin(vin.Prevout.Value),
			PrevTxid: vin.Txid,
			PrevVout: vin.Vout,
		})
		n.TotalIn += satoshiToCoin(vin.Prevout.Value)
	}
	for i, vout := range tx.Vout {
		n.Outputs = append(n.Outputs, TraceIO{
			Index: i,
			Addr:  vout.ScriptpubkeyAddress,
			Value: satoshiToCoin(vout.Value),
		})
		n.TotalOut += satoshiToCoin(vout.Value)
	}
	n.TotalIn = roundTo(n.TotalIn, 8)
	n.TotalOut = roundTo(n.TotalOut, 8)
	return n
}

// ─── Сетевые вызовы mempool.space ────────────────────────────────────────────

func fetchMempoolTx(ctx context.Context, txid string) (mempoolTraceTx, error) {
	u := mempoolBase + "/api/tx/" + url.PathEscape(txid)
	var tx mempoolTraceTx
	if err := fetchJSONRetry(ctx, u, &tx, 20*time.Second, 2); err != nil {
		return mempoolTraceTx{}, fmt.Errorf("tx %s: %w", txid, err)
	}
	return tx, nil
}

func fetchMempoolOutspends(ctx context.Context, txid string) ([]outspendInfo, error) {
	u := mempoolBase + "/api/tx/" + url.PathEscape(txid) + "/outspends"
	var arr []outspendInfo
	if err := fetchJSONRetry(ctx, u, &arr, 20*time.Second, 2); err != nil {
		return nil, fmt.Errorf("outspends %s: %w", txid, err)
	}
	return arr, nil
}
