const BTC_RE = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/i;
const ETH_RE = /^0x[a-fA-F0-9]{40}$/;

const lookupForm = document.getElementById("lookupForm");
const walletInput = document.getElementById("walletInput");
const lookupBtn = document.getElementById("lookupBtn");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const overviewEl = document.getElementById("overview");
const metricTemplate = document.getElementById("metricTemplate");

const btcWorkbench = document.getElementById("btcWorkbench");
const btcHeadline = document.getElementById("btcHeadline");
const btcSubline = document.getElementById("btcSubline");
const btcSummaryGrid = document.getElementById("btcSummaryGrid");
const btcWarnings = document.getElementById("btcWarnings");
const maxTxRange = document.getElementById("maxTxRange");
const maxTxInput = document.getElementById("maxTxInput");
const maxTxBadge = document.getElementById("maxTxBadge");
const fetchTxBtn = document.getElementById("fetchTxBtn");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");
const fDateFrom = document.getElementById("fDateFrom");
const fDateTo = document.getElementById("fDateTo");
const fMinBtc = document.getElementById("fMinBtc");
const fMaxBtc = document.getElementById("fMaxBtc");
const fDirection = document.getElementById("fDirection");

const btcTableWrap = document.getElementById("btcTableWrap");
const btcTableBody = document.getElementById("btcTableBody");
const btcTableMeta = document.getElementById("btcTableMeta");
const btcQuickFilter = document.getElementById("btcQuickFilter");

const ethWorkbench = document.getElementById("ethWorkbench");
const ethHeadline = document.getElementById("ethHeadline");
const ethSubline = document.getElementById("ethSubline");
const ethSummaryGrid = document.getElementById("ethSummaryGrid");
const ethWarnings = document.getElementById("ethWarnings");
const ethMaxTxRange = document.getElementById("ethMaxTxRange");
const ethMaxTxInput = document.getElementById("ethMaxTxInput");
const ethMaxTxBadge = document.getElementById("ethMaxTxBadge");
const ethFetchTxBtn = document.getElementById("ethFetchTxBtn");
const ethResetFiltersBtn = document.getElementById("ethResetFiltersBtn");
const ethFDateFrom = document.getElementById("ethFDateFrom");
const ethFDateTo = document.getElementById("ethFDateTo");
const ethFMinEth = document.getElementById("ethFMinEth");
const ethFMaxEth = document.getElementById("ethFMaxEth");
const ethFDirection = document.getElementById("ethFDirection");

const ethTableWrap = document.getElementById("ethTableWrap");
const ethTableBody = document.getElementById("ethTableBody");
const ethTableMeta = document.getElementById("ethTableMeta");
const ethQuickFilter = document.getElementById("ethQuickFilter");

const txModal = document.getElementById("txModal");
const txModalBody = document.getElementById("txModalBody");
const txModalClose = document.getElementById("txModalClose");

const FETCH_TIMEOUT_MS = 175000;

let lastBtcAddress = null;
let lastEthAddress = null;
let lastBtcRows = [];
let lastEthRows = [];

function detectChain(address) {
  const a = address.trim();
  if (BTC_RE.test(a)) return "bitcoin";
  if (ETH_RE.test(a)) return "ethereum";
  return null;
}

function setBusy(busy, message) {
  lookupBtn.disabled = busy;
  fetchTxBtn.disabled = busy;
  ethFetchTxBtn.disabled = busy;
  lookupBtn.textContent = busy ? "Ждём…" : "Продолжить";
  fetchTxBtn.textContent = busy ? "Загрузка…" : "Выгрузить транзакции";
  ethFetchTxBtn.textContent = busy ? "Загрузка…" : "Выгрузить транзакции";
  statusEl.textContent = message || "";
  progressEl.classList.toggle("hidden", !busy);
}

function clearSharedResults() {
  overviewEl.innerHTML = "";
}

function clearBtcBoard() {
  btcSummaryGrid.innerHTML = "";
  btcWarnings.innerHTML = "";
  btcTableBody.innerHTML = "";
  btcTableWrap.classList.add("hidden");
  btcQuickFilter.value = "";
  lastBtcRows = [];
}

function clearEthBoard() {
  ethSummaryGrid.innerHTML = "";
  ethWarnings.innerHTML = "";
  ethTableBody.innerHTML = "";
  ethTableWrap.classList.add("hidden");
  ethQuickFilter.value = "";
  lastEthRows = [];
}

function showBtcWorkbench(show) {
  btcWorkbench.classList.toggle("hidden", !show);
}

function showEthWorkbench(show) {
  ethWorkbench.classList.toggle("hidden", !show);
}

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = walletInput.value.trim();
  if (!address) return;

  const chain = detectChain(address);
  if (!chain) {
    statusEl.textContent = "Не удалось распознать адрес. Поддерживаются BTC и ETH.";
    return;
  }

  clearSharedResults();
  closeTxModal();

  if (chain === "ethereum") {
    showBtcWorkbench(false);
    clearBtcBoard();
    btcTableWrap.classList.add("hidden");
    await runEthereumProfile(address);
    return;
  }

  showEthWorkbench(false);
  clearEthBoard();
  ethTableWrap.classList.add("hidden");
  await runBitcoinProfile(address);
});

maxTxRange.addEventListener("input", () => {
  maxTxInput.value = maxTxRange.value;
  maxTxBadge.textContent = `${maxTxRange.value} шт.`;
});

maxTxInput.addEventListener("change", () => {
  syncMaxTxFromInput();
});

ethMaxTxRange.addEventListener("input", () => {
  ethMaxTxInput.value = ethMaxTxRange.value;
  ethMaxTxBadge.textContent = `${ethMaxTxRange.value} шт.`;
});

ethMaxTxInput.addEventListener("change", () => {
  syncEthMaxTxFromInput();
});

fetchTxBtn.addEventListener("click", async () => {
  if (!lastBtcAddress) return;
  await runBitcoinExport(lastBtcAddress);
});

ethFetchTxBtn.addEventListener("click", async () => {
  if (!lastEthAddress) return;
  await runEthereumExport(lastEthAddress);
});

resetFiltersBtn.addEventListener("click", () => {
  fDateFrom.value = "";
  fDateTo.value = "";
  fMinBtc.value = "";
  fMaxBtc.value = "";
  fDirection.value = "";
});

ethResetFiltersBtn.addEventListener("click", () => {
  ethFDateFrom.value = "";
  ethFDateTo.value = "";
  ethFMinEth.value = "";
  ethFMaxEth.value = "";
  ethFDirection.value = "";
  const inc = document.getElementById("ethIncludeInternal");
  if (inc) inc.checked = false;
});

btcQuickFilter.addEventListener("input", () => {
  const q = btcQuickFilter.value.trim().toLowerCase();
  const rows = !q
    ? lastBtcRows
    : lastBtcRows.filter((tx) => {
        const blob = `${tx.hash} ${tx.from} ${tx.to} ${(tx.inputs || [])
          .map((i) => i.addr)
          .join(" ")} ${(tx.outputs || []).map((o) => o.addr).join(" ")}`.toLowerCase();
        return blob.includes(q);
      });
  renderBtcTableRows(rows);
});

ethQuickFilter.addEventListener("input", () => {
  const q = ethQuickFilter.value.trim().toLowerCase();
  const rows = !q
    ? lastEthRows
    : lastEthRows.filter((tx) => {
        const blob = `${tx.hash} ${tx.from} ${tx.to} ${tx.input || ""} ${tx.methodId || ""} ${tx.functionName || ""}`.toLowerCase();
        return blob.includes(q);
      });
  renderEthTableRows(rows);
});

async function runEthereumProfile(address) {
  setBusy(true, "Запрашиваем профиль Ethereum…");
  clearEthBoard();
  showEthWorkbench(false);

  try {
    const response = await fetchWithTimeout(`/api/eth/summary?address=${encodeURIComponent(address)}`, 25000);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Ошибка summary");
    }
    const summary = await response.json();
    lastEthAddress = address;

    ethHeadline.textContent = shortAddress(address);
    ethSubline.textContent = "Выберите объём выборки и фильтры, затем запросите транзакции.";
    renderEthSummaryCards(summary);
    configureEthMaxTxControls(summary);
    showEthWorkbench(true);

    clearSharedResults();
    showForensicsBanner(address, 'ETH');

    statusEl.textContent =
      typeof summary.nTx === "number" && summary.nTx >= 0
        ? `В сети у адреса ${formatInt(summary.nTx)} транзакций. Настройте выборку и нажмите «Выгрузить транзакции».`
        : "Настройте выборку и нажмите «Выгрузить транзакции».";
  } catch (error) {
    statusEl.textContent = `Ошибка: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

function renderEthSummaryCards(summary) {
  ethSummaryGrid.innerHTML = "";
  const totalTx =
    typeof summary.nTx === "number" && summary.nTx >= 0 ? formatInt(summary.nTx) : "—";
  const recv =
    typeof summary.totalReceived === "number" && summary.totalReceived >= 0
      ? `${formatNumber(summary.totalReceived)} ETH`
      : "—";
  const sent =
    typeof summary.totalSent === "number" && summary.totalSent >= 0
      ? `${formatNumber(summary.totalSent)} ETH`
      : "—";
  const cards = [
    ["Всего транзакций", totalTx],
    ["Баланс", `${formatNumber(summary.balance)} ETH`],
    ["Всего получено", recv],
    ["Всего отправлено", sent],
    ["Неизрасходованных выходов", formatInt(summary.nUnredeemed)]
  ];
  cards.forEach(([title, value], i) => {
    const node = metricTemplate.content.firstElementChild.cloneNode(true);
    node.style.animationDelay = `${i * 55}ms`;
    node.querySelector(".metric-title").textContent = title;
    node.querySelector(".metric-value").textContent = value;
    ethSummaryGrid.appendChild(node);
  });
}

function configureEthMaxTxControls(summary) {
  const unknown = typeof summary.nTx !== "number" || summary.nTx < 0;
  const cap = unknown
    ? 20000
    : Math.min(20000, Math.max(1, summary.nTx || 1));
  ethMaxTxRange.min = "1";
  ethMaxTxRange.max = String(cap);
  const def = unknown
    ? Math.min(500, cap)
    : Math.min(cap, Math.max(1, Math.min(500, cap)));
  ethMaxTxRange.value = String(def);
  ethMaxTxInput.min = "1";
  ethMaxTxInput.max = String(cap);
  ethMaxTxInput.value = String(def);
  ethMaxTxBadge.textContent = `${def} шт.`;
  ethFetchTxBtn.disabled = !unknown && (cap === 0 || summary.nTx === 0);
}

function syncEthMaxTxFromInput() {
  const cap = Number(ethMaxTxInput.max) || 20000;
  let v = Number(ethMaxTxInput.value);
  if (!Number.isFinite(v)) v = 1;
  v = Math.max(1, Math.min(cap, Math.floor(v)));
  ethMaxTxInput.value = String(v);
  ethMaxTxRange.value = String(v);
  ethMaxTxBadge.textContent = `${v} шт.`;
}

async function runEthereumExport(address) {
  syncEthMaxTxFromInput();
  const maxTx = Number(ethMaxTxInput.value) || 1;
  const params = new URLSearchParams({ address, maxTx: String(maxTx) });

  if (ethFDateFrom.value) params.set("dateFrom", ethFDateFrom.value);
  if (ethFDateTo.value) params.set("dateTo", ethFDateTo.value);
  const minE = ethFMinEth.value.trim();
  const maxE = ethFMaxEth.value.trim();
  if (minE) params.set("minEth", minE);
  if (maxE) params.set("maxEth", maxE);
  const dir = ethFDirection.value;
  if (dir) params.set("direction", dir);

  const includeInternal = document.getElementById("ethIncludeInternal")?.checked;
  if (includeInternal) params.set("includeInternal", "1");

  setBusy(true, `Загружаем до ${formatInt(maxTx)} транзакций…`);

  try {
    const response = await fetchWithTimeout(`/api/eth/analyze?${params.toString()}`, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Ошибка analyze");
    }
    const data = await response.json();

    ethWarnings.innerHTML = "";
    (data.warnings || []).forEach((w) => {
      const span = document.createElement("span");
      span.className = "warn-chip";
      span.textContent = w;
      ethWarnings.appendChild(span);
    });

    renderEthResultOverview(data);
    lastEthRows = data.transactions || [];
    ethQuickFilter.value = "";
    renderEthTableRows(lastEthRows);
    ethTableMeta.textContent = `Запрошено: ${formatInt(data.requestedFetch)} · загружено с API: ${formatInt(data.fetched)} · после фильтров: ${formatInt(data.afterFilters)}`;
    ethTableWrap.classList.remove("hidden");

    statusEl.textContent = `Готово. Показано ${formatInt(data.afterFilters)} транзакций после фильтрации.`;
  } catch (error) {
    statusEl.textContent = `Ошибка: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

function renderEthResultOverview(data) {
  overviewEl.innerHTML = "";
  const ton =
    typeof data.totalOnChain === "number" && data.totalOnChain >= 0
      ? formatInt(data.totalOnChain)
      : "неизвестно";
  const metrics = [
    ["Сеть", "ETHEREUM"],
    ["Адрес", shortAddress(data.address)],
    ["Баланс", `${formatNumber(data.balance)} ETH`],
    ["В сети всего транзакций", ton],
    ["Загружено в этот запрос", formatInt(data.fetched)],
    ["После фильтров", formatInt(data.afterFilters)],
    ["Входящих (в выборке)", formatInt(data.incomingTx)],
    ["Исходящих (в выборке)", formatInt(data.outgoingTx)],
    ["Сумма входов (фильтр)", `${formatNumber(data.totalIn)} ETH`],
    ["Сумма выходов (фильтр)", `${formatNumber(data.totalOut)} ETH`],
    ["Чистый поток (фильтр)", `${formatNumber(data.netFlow)} ETH`],
    ["Нейтральных / пропущено", formatInt(data.skippedNeutral)]
  ];
  metrics.forEach(([title, value], i) => {
    const node = metricTemplate.content.firstElementChild.cloneNode(true);
    node.style.animationDelay = `${i * 40}ms`;
    node.querySelector(".metric-title").textContent = title;
    node.querySelector(".metric-value").textContent = value;
    overviewEl.appendChild(node);
  });
}

function renderEthTableRows(rows) {
  ethTableBody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="muted" style="padding:1.1rem;">Нет строк для отображения.</td>`;
    ethTableBody.appendChild(tr);
    return;
  }

  rows.forEach((tx) => {
    const tr = document.createElement("tr");
    const dir = tx.direction;
    const pillClass =
      dir === "out" ? "pill-out" : dir === "in" ? "pill-in" : "pill-contract";
    const amountClass =
      dir === "out" ? "amount-out" : dir === "in" ? "amount-in" : "value-neutral";
    const sign = dir === "out" ? "−" : dir === "in" ? "+" : "";
    const href = safeUrl(tx.explorerUrl);
    const hashCell = href
      ? `<a class="tx-link mono" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(short(tx.hash, 18))}</a>`
      : `<span class="mono muted">${escapeHtml(short(tx.hash, 18))}</span>`;

    const gasCell = `${formatInt(tx.gasUsed || 0)} / ${formatInt(tx.gas || 0)}`;

    tr.innerHTML = `
      <td>${escapeHtml(toLocalDate(tx.date))}</td>
      <td><span class="pill-dir ${pillClass}">${escapeHtml(dir || "—")}</span></td>
      <td class="right ${amountClass}">${dir === "contract" ? formatNumber(tx.amount) : `${sign}${formatNumber(tx.amount)}`}</td>
      <td class="right mono">${formatNumber(tx.fee)}</td>
      <td class="right mono">${gasCell}</td>
      <td class="right mono">${tx.blockNumber ? formatInt(tx.blockNumber) : "—"}</td>
      <td><span class="tx-status ${tx.status === "confirmed" ? "status-good" : "status-bad"}">${escapeHtml(tx.status || "")}</span></td>
      <td>${hashCell}</td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      openEthRichModal(tx);
    });
    ethTableBody.appendChild(tr);
  });
}

function openEthRichModal(tx) {
  const s = (v) => escapeHtml(v == null || v === "" ? "—" : String(v));
  const explorer =
    tx.explorerUrl && safeUrl(tx.explorerUrl)
      ? `<a class="tx-link" href="${safeUrl(tx.explorerUrl)}" target="_blank" rel="noreferrer">Открыть в обозревателе</a>`
      : "—";

  const vin = tx.from ? 1 : 0;
  const vout = tx.to ? 1 : 0;
  const totalInAll =
    tx.direction === "out" ? Number(tx.amount || 0) + Number(tx.fee || 0) : Number(tx.amount || 0);
  const totalOutAll = tx.direction === "in" ? Number(tx.amount || 0) : 0;

  const rows = [
    ["Сеть", "ETHEREUM"],
    ["Хэш", s(tx.hash)],
    ["Обозреватель", explorer],
    ["Дата (UTC)", s(tx.date)],
    ["Направление", s(tx.direction)],
    ["Сумма (кошелёк)", `${formatNumber(tx.amount)} ETH`],
    ["Комиссия", `${formatNumber(tx.fee)} ETH`],
    ["Статус", s(tx.status)],
    ["Версия / locktime", `${s(tx.nonce)} / ${s(tx.confirmations)}`],
    ["Размер / вес", `${s(tx.gasUsed)} gas · ${s(tx.gas)} лимит`],
    ["Входы / выходы", `${vin} / ${vout}`],
    ["Блок / индекс", `${s(tx.blockNumber)} / ${s(tx.transactionIndex)}`],
    ["Double-spend", "нет"],
    ["Relayed by", "—"],
    ["Сумма входов (все)", `${formatNumber(totalInAll)} ETH`],
    ["Сумма выходов (все)", `${formatNumber(totalOutAll)} ETH`],
    ["Первый вход → первый выход", `${s(tx.from)} → ${s(tx.to)}`]
  ];

  const inList = tx.from ? [{ addr: tx.from, value: tx.direction === "out" ? tx.amount : 0 }] : [];
  const outList = tx.to ? [{ addr: tx.to, value: tx.direction === "in" ? tx.amount : 0 }] : [];

  txModalBody.innerHTML = `
    <dl class="modal-grid">
      ${rows
        .map(([k, v]) => `<dt class="modal-key">${escapeHtml(k)}</dt><dd class="modal-value">${v}</dd>`)
        .join("")}
    </dl>
    ${ioSection("Входы", inList, "ETH")}
    ${ioSection("Выходы", outList, "ETH")}
  `;

  txModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

async function runBitcoinProfile(address) {
  setBusy(true, "Запрашиваем профиль Bitcoin…");
  clearBtcBoard();
  showBtcWorkbench(false);

  try {
    const response = await fetchWithTimeout(`/api/btc/summary?address=${encodeURIComponent(address)}`, 25000);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Ошибка summary");
    }
    const summary = await response.json();
    lastBtcAddress = address;

    btcHeadline.textContent = shortAddress(address);
    btcSubline.textContent = "Выберите объём выборки и фильтры, затем запросите транзакции.";
    renderBtcSummaryCards(summary);
    configureMaxTxControls(summary.nTx || 0);
    showBtcWorkbench(true);
    clearSharedResults();
    showForensicsBanner(address, 'BTC');

    statusEl.textContent = `В сети у адреса ${formatInt(summary.nTx)} транзакций. Настройте выборку и нажмите «Выгрузить транзакции».`;
  } catch (error) {
    statusEl.textContent = `Ошибка: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

function renderBtcSummaryCards(summary) {
  btcSummaryGrid.innerHTML = "";
  const cards = [
    ["Всего транзакций", formatInt(summary.nTx)],
    ["Баланс", `${formatNumber(summary.balance)} BTC`],
    ["Всего получено", `${formatNumber(summary.totalReceived)} BTC`],
    ["Всего отправлено", `${formatNumber(summary.totalSent)} BTC`],
    ["Неизрасходованных выходов", formatInt(summary.nUnredeemed)]
  ];
  cards.forEach(([title, value], i) => {
    const node = metricTemplate.content.firstElementChild.cloneNode(true);
    node.style.animationDelay = `${i * 55}ms`;
    node.querySelector(".metric-title").textContent = title;
    node.querySelector(".metric-value").textContent = value;
    btcSummaryGrid.appendChild(node);
  });
}

function configureMaxTxControls(nTx) {
  const cap = Math.min(20000, Math.max(1, nTx || 1));
  maxTxRange.min = "1";
  maxTxRange.max = String(cap);
  const def = Math.min(cap, Math.max(1, Math.min(500, cap)));
  maxTxRange.value = String(def);
  maxTxInput.min = "1";
  maxTxInput.max = String(cap);
  maxTxInput.value = String(def);
  maxTxBadge.textContent = `${def} шт.`;
  fetchTxBtn.disabled = cap === 0 || nTx === 0;
}

function syncMaxTxFromInput() {
  const cap = Number(maxTxInput.max) || 20000;
  let v = Number(maxTxInput.value);
  if (!Number.isFinite(v)) v = 1;
  v = Math.max(1, Math.min(cap, Math.floor(v)));
  maxTxInput.value = String(v);
  maxTxRange.value = String(v);
  maxTxBadge.textContent = `${v} шт.`;
}

async function runBitcoinExport(address) {
  syncMaxTxFromInput();
  const maxTx = Number(maxTxInput.value) || 1;
  const params = new URLSearchParams({ address, maxTx: String(maxTx) });

  if (fDateFrom.value) params.set("dateFrom", fDateFrom.value);
  if (fDateTo.value) params.set("dateTo", fDateTo.value);
  const minB = fMinBtc.value.trim();
  const maxB = fMaxBtc.value.trim();
  if (minB) params.set("minBtc", minB);
  if (maxB) params.set("maxBtc", maxB);
  const dir = fDirection.value;
  if (dir) params.set("direction", dir);

  setBusy(true, `Загружаем до ${formatInt(maxTx)} транзакций с blockchain.info (несколько страниц)…`);

  try {
    const response = await fetchWithTimeout(`/api/btc/analyze?${params.toString()}`, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Ошибка analyze");
    }
    const data = await response.json();

    btcWarnings.innerHTML = "";
    (data.warnings || []).forEach((w) => {
      const span = document.createElement("span");
      span.className = "warn-chip";
      span.textContent = w;
      btcWarnings.appendChild(span);
    });

    renderBtcResultOverview(data);
    lastBtcRows = data.transactions || [];
    btcQuickFilter.value = "";
    renderBtcTableRows(lastBtcRows);
    btcTableMeta.textContent = `Запрошено: ${formatInt(data.requestedFetch)} · загружено с API: ${formatInt(data.fetched)} · после фильтров: ${formatInt(data.afterFilters)}`;
    btcTableWrap.classList.remove("hidden");

    statusEl.textContent = `Готово. Показано ${formatInt(data.afterFilters)} транзакций после фильтрации.`;
  } catch (error) {
    statusEl.textContent = `Ошибка: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

function renderBtcResultOverview(data) {
  overviewEl.innerHTML = "";
  const metrics = [
    ["Сеть", "BITCOIN"],
    ["Адрес", shortAddress(data.address)],
    ["Баланс", `${formatNumber(data.balance)} BTC`],
    ["В сети всего транзакций", formatInt(data.totalOnChain)],
    ["Загружено в этот запрос", formatInt(data.fetched)],
    ["После фильтров", formatInt(data.afterFilters)],
    ["Входящих (в выборке)", formatInt(data.incomingTx)],
    ["Исходящих (в выборке)", formatInt(data.outgoingTx)],
    ["Сумма входов (фильтр)", `${formatNumber(data.totalIn)} BTC`],
    ["Сумма выходов (фильтр)", `${formatNumber(data.totalOut)} BTC`],
    ["Чистый поток (фильтр)", `${formatNumber(data.netFlow)} BTC`],
    ["Нейтральных / пропущено", formatInt(data.skippedNeutral)]
  ];
  metrics.forEach(([title, value], i) => {
    const node = metricTemplate.content.firstElementChild.cloneNode(true);
    node.style.animationDelay = `${i * 40}ms`;
    node.querySelector(".metric-title").textContent = title;
    node.querySelector(".metric-value").textContent = value;
    overviewEl.appendChild(node);
  });
}

function renderBtcTableRows(rows) {
  btcTableBody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="muted" style="padding:1.1rem;">Нет строк для отображения.</td>`;
    btcTableBody.appendChild(tr);
    return;
  }

  rows.forEach((tx) => {
    const tr = document.createElement("tr");
    const dir = tx.direction;
    const pillClass = dir === "out" ? "pill-out" : "pill-in";
    const amountClass = dir === "out" ? "amount-out" : "amount-in";
    const sign = dir === "out" ? "−" : "+";
    const href = safeUrl(tx.explorerUrl);
    const hashCell = href
      ? `<a class="tx-link mono" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(short(tx.hash, 18))}</a>`
      : `<span class="mono muted">${escapeHtml(short(tx.hash, 18))}</span>`;

    tr.innerHTML = `
      <td>${escapeHtml(toLocalDate(tx.date))}</td>
      <td><span class="pill-dir ${pillClass}">${escapeHtml(dir || "—")}</span></td>
      <td class="right ${amountClass}">${sign}${formatNumber(tx.amount)}</td>
      <td class="right mono">${formatNumber(tx.fee)}</td>
      <td class="right mono">${formatInt(tx.size)} / ${formatInt(tx.weight)}</td>
      <td class="right mono">${tx.blockHeight ? formatInt(tx.blockHeight) : "—"}</td>
      <td><span class="tx-status ${tx.status === "confirmed" ? "status-good" : "status-bad"}">${escapeHtml(tx.status || "")}</span></td>
      <td>${hashCell}</td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      openBtcModal(tx);
    });
    btcTableBody.appendChild(tr);
  });
}

function openBtcModal(tx) {
  const s = (v) => escapeHtml(v == null || v === "" ? "—" : String(v));
  const explorer =
    tx.explorerUrl && safeUrl(tx.explorerUrl)
      ? `<a class="tx-link" href="${safeUrl(tx.explorerUrl)}" target="_blank" rel="noreferrer">Открыть в обозревателе</a>`
      : "—";

  const rows = [
    ["Сеть", "BITCOIN"],
    ["Хэш", s(tx.hash)],
    ["Обозреватель", explorer],
    ["Дата (UTC)", s(tx.date)],
    ["Направление", s(tx.direction)],
    ["Сумма (кошелёк)", `${formatNumber(tx.amount)} BTC`],
    ["Комиссия", `${formatNumber(tx.fee)} BTC`],
    ["Статус", s(tx.status)],
    ["Версия / locktime", `${s(tx.version)} / ${s(tx.lockTime)}`],
    ["Размер / вес", `${s(tx.size)} байт · ${s(tx.weight)} wu`],
    ["Входы / выходы", `${s(tx.vinSz)} / ${s(tx.voutSz)}`],
    ["Блок / индекс", `${s(tx.blockHeight)} / ${s(tx.blockIndex)}`],
    ["Double-spend", tx.doubleSpend ? "да" : "нет"],
    ["Relayed by", s(tx.relayedBy)],
    ["Сумма входов (все)", `${formatNumber(tx.totalInValue)} BTC`],
    ["Сумма выходов (все)", `${formatNumber(tx.totalOutValue)} BTC`],
    ["Первый вход → первый выход", `${s(tx.from)} → ${s(tx.to)}`]
  ];

  txModalBody.innerHTML = `
    <dl class="modal-grid">
      ${rows
        .map(([k, v]) => `<dt class="modal-key">${escapeHtml(k)}</dt><dd class="modal-value">${v}</dd>`)
        .join("")}
    </dl>
    ${ioSection("Входы", tx.inputs, "BTC")}
    ${ioSection("Выходы", tx.outputs, "BTC")}
  `;

  txModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeTxModal() {
  txModal.classList.add("hidden");
  txModalBody.innerHTML = "";
  document.body.style.overflow = "";
}

txModalClose.addEventListener("click", closeTxModal);
txModal.addEventListener("click", (event) => {
  const target = event.target;
  if (target && target.dataset && target.dataset.closeModal === "true") {
    closeTxModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !txModal.classList.contains("hidden")) {
    closeTxModal();
  }
});

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function short(value, max = 26) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function shortAddress(addr) {
  if (!addr || addr.length < 14) return addr || "-";
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

function formatNumber(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 }).format(n);
}

function formatInt(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}

function toLocalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString("ru-RU");
}

function humanDirection(value) {
  if (value === "in") return "Входящая";
  if (value === "out") return "Исходящая";
  if (value === "contract") return "Контрактная операция";
  return value || "-";
}

function ioSection(title, items, unit) {
  if (!items || !items.length) return "";
  const body = items
    .map(
      (item) => `
      <div class="io-row">
        <span class="mono">${escapeHtml(item.addr)}</span>
        <span class="mono">${formatNumber(item.value)} ${unit}</span>
      </div>`
    )
    .join("");
  return `
      <div class="io-block">
        <p class="io-title">${escapeHtml(title)}</p>
        ${body}
      </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href.replace(/"/g, "%22");
  } catch {
    return "";
  }
}

function prefillDemoAddress() {
  const preset = new URLSearchParams(location.search).get("w");
  if (preset === "btc") {
    walletInput.value = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    statusEl.textContent = "Адрес подставлен. Нажмите «Продолжить», затем применяйте фильтры и выгрузку.";
  } else if (preset === "eth") {
    walletInput.value = "0x1111111122222222333333334444444455555555";
    statusEl.textContent = "Адрес подставлен. Нажмите «Продолжить», затем применяйте фильтры и выгрузку.";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", prefillDemoAddress);
} else {
  prefillDemoAddress();
}

// ─── Forensics Banner ────────────────────────────────────────────────────────
// Shown after profile load — invites user to open the graph
function showForensicsBanner(address, coin) {
  // Remove old banner if any
  document.getElementById("forensics-banner")?.remove();

  const banner = document.createElement("div");
  banner.id = "forensics-banner";
  banner.innerHTML = `
    <div style="
      display:flex;align-items:center;gap:16px;
      padding:14px 20px;margin:0 0 16px;
      background:linear-gradient(135deg,rgba(37,99,235,0.12),rgba(8,145,178,0.08));
      border:1px solid rgba(59,130,246,0.25);border-radius:12px;
      animation:fadeSlideIn .35s cubic-bezier(.4,0,.2,1);
    ">
      <div style="
        width:40px;height:40px;flex-shrink:0;border-radius:10px;
        background:linear-gradient(135deg,#2563eb,#0891b2);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 16px rgba(59,130,246,0.3);
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
          <line x1="6" y1="6" x2="10" y2="11"/><line x1="18" y1="6" x2="14" y2="11"/>
          <line x1="6" y1="18" x2="10" y2="13"/><line x1="18" y1="18" x2="14" y2="13"/>
        </svg>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13.5px;font-weight:600;color:#e2e8f0;margin-bottom:2px;">
          Открыть граф транзакций
        </div>
        <div style="font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          Визуализировать связи и получить оценку риска для <span style="color:#60a5fa;font-family:monospace;">${address}</span>
        </div>
      </div>
      <a href="/forensics.html?address=${encodeURIComponent(address)}" style="
        display:inline-flex;align-items:center;gap:7px;
        padding:9px 18px;white-space:nowrap;
        background:linear-gradient(135deg,#2563eb,#0891b2);
        border-radius:8px;color:#fff;font-size:13px;font-weight:500;
        text-decoration:none;flex-shrink:0;
        box-shadow:0 4px 14px rgba(59,130,246,0.3);
        transition:box-shadow .2s,opacity .2s;
      " onmouseover="this.style.boxShadow='0 4px 20px rgba(59,130,246,0.5)'" onmouseout="this.style.boxShadow='0 4px 14px rgba(59,130,246,0.3)'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
          <line x1="6" y1="6" x2="10" y2="11"/><line x1="18" y1="6" x2="14" y2="11"/>
          <line x1="6" y1="18" x2="10" y2="13"/><line x1="18" y1="18" x2="14" y2="13"/>
        </svg>
        Открыть Forensics
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </a>
    </div>
  `;

  // Insert before the workbench (first visible workbench)
  const bench = coin === 'BTC'
    ? document.getElementById("btcWorkbench")
    : document.getElementById("ethWorkbench");
  if (bench) bench.insertAdjacentElement("beforebegin", banner);
}

// Inject animation keyframe once
const _style = document.createElement("style");
_style.textContent = `@keyframes fadeSlideIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}`;
document.head.appendChild(_style);
