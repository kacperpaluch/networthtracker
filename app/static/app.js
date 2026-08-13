const state = {
  dashboard: null,
  view: "dashboard",
  chartRange: "1y",
  selectedMonth: null,
  selectedYear: new Date().getFullYear(),
  reportMode: "monthly",
  selectedAccount: null,
  allAccounts: null,
  showArchived: false,
  historySnapshots: [],
  historyData: null,
  history: { range: "1y", from: "", to: "", page: 1, pageSize: 10 },
  activity: {
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
    hasMore: false,
    loading: false,
    requestId: 0,
    filters: { from: "", to: "", accountId: "", source: "", preset: "30" },
  },
  baseCurrency: "PLN",
  dateFormat: "DD.MM.YYYY",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const main = $("#mainContent");

let money;
let summaryMoney;
let detailMoney;
let compactMoney;
function configureFormatters(currency = "PLN") {
  state.baseCurrency = currency;
  money = new Intl.NumberFormat("pl-PL", {
    style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  summaryMoney = new Intl.NumberFormat("pl-PL", {
    style: "currency", currency, maximumFractionDigits: 0,
  });
  detailMoney = new Intl.NumberFormat("pl-PL", {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  compactMoney = new Intl.NumberFormat("pl-PL", {
    notation: "compact", style: "currency", currency, maximumFractionDigits: 1,
  });
  $("#profileCurrency").textContent = `Waluta: ${currency}`;
  $("#goalCurrency").textContent = currency;
}
configureFormatters();
const monthFormatter = new Intl.DateTimeFormat("pl-PL", {
  month: "long",
  year: "numeric",
});
const shortMonthFormatter = new Intl.DateTimeFormat("pl-PL", {
  month: "short",
  year: "numeric",
});

function dateValue(value) {
  return new Date(`${value}T12:00:00`);
}
function dateLabel(value) {
  const [year, month, day] = value.split("-");
  if (state.dateFormat === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  if (state.dateFormat === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  return `${day}.${month}.${year}`;
}
function isoDateOffset(days = 0) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}
function nativeMoney(value, currency) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}
function subtractMonths(value, months) {
  const result = new Date(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}
function filterTimelineByRange(items, range) {
  if (range === "max" || !items.length) return items;
  const months = range === "6m" ? 6 : 12;
  const latest = dateValue(items.at(-1).date || items.at(-1).snapshot_date);
  const cutoff = subtractMonths(latest, months);
  return items.filter((item) => dateValue(item.date || item.snapshot_date) >= cutoff);
}
function aggregateTimelineForChart(items, range) {
  if (range === "6m") return items;
  const buckets = new Map();
  items.forEach((item) => {
    const value = dateValue(item.date || item.snapshot_date);
    let key;
    if (range === "max") {
      key = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
    } else {
      const monday = new Date(value);
      monday.setDate(value.getDate() - ((value.getDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    }
    buckets.set(key, item);
  });
  return [...buckets.values()];
}
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function accountGlyph(category) {
  if (category === "Nieruchomości") return "⌂";
  if (category === "Inwestycje") return "↗";
  if (category === "Kredyty") return "▰";
  if (category === "Karty") return "▭";
  return "◫";
}
function signed(value) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${money.format(Math.abs(value))}`;
}
function signedDetail(value) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${detailMoney.format(Math.abs(value))}`;
}
function monthLabel(value) {
  return shortMonthFormatter.format(dateValue(`${value}-01`)).replace(" ", " ");
}
function goalStatus(goal) {
  return ({
    ahead: ["Przed planem", "positive"],
    on_track: ["Zgodnie z planem", "positive"],
    behind: ["Za planem", "negative"],
    overdue: ["Po terminie", "negative"],
    completed: ["Cel osiągnięty", "positive"],
    no_deadline: ["Bez terminu", "neutral"],
  })[goal.paceStatus] || ["Bez terminu", "neutral"];
}
function statisticChange(metric, empty = "Za mało danych") {
  if (!metric) return `<strong>—</strong><small>${empty}</small>`;
  const tone = metric.amount >= 0 ? "positive" : "negative";
  return `<strong class="${tone}">${signed(metric.amount)}</strong><small>${metric.amount >= 0 ? "+" : ""}${metric.percent}%</small>`;
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = `✓ ${message}`;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3000);
}
function showModal(id) {
  $(`#${id}`).hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModals() {
  $$(".modal-backdrop").forEach((modal) => { modal.hidden = true; });
  document.body.style.overflow = "";
}
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let message = "Operacja nie powiodła się";
    try {
      const payload = await response.json();
      message = payload.detail || message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function loadDashboard() {
  try {
    state.dashboard = await api("/dashboard");
    state.dateFormat = state.dashboard.summary.dateFormat || "DD.MM.YYYY";
    configureFormatters(state.dashboard.summary.baseCurrency || "PLN");
    state.allAccounts = null;
    $("#errorBanner").hidden = true;
    $("#accountCount").textContent = state.dashboard.accounts.length;
    $("#lastUpdated").textContent = `Salda: ${dateLabel(state.dashboard.summary.updatedAt)}`;
    if (!state.selectedMonth) {
      state.selectedMonth = state.dashboard.timeline.at(-1)?.date.slice(0, 7) || new Date().toISOString().slice(0, 7);
    }
    renderNotifications();
    renderView();
  } catch (error) {
    $("#errorBanner").hidden = false;
    main.innerHTML = "";
  }
}

function setView(view) {
  state.view = view;
  const titles = {
    dashboard: "Przegląd majątku",
    accounts: "Twoje konta",
    activity: "Historia aktualizacji",
    report: "Raport miesięczny",
    goals: "Cele finansowe",
  };
  $("#pageTitle").textContent = titles[view];
  $$(".nav-item, .sidebar-tools button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  $("#sidebar").classList.remove("open");
  renderView();
}

function renderView() {
  if (!state.dashboard) return;
  if (state.view === "dashboard") renderDashboard();
  if (state.view === "accounts") renderAccounts();
  if (state.view === "activity") renderActivity();
  if (state.view === "report") renderReport();
  if (state.view === "goals") renderGoals();
}

function renderDashboard() {
  const { summary, accounts, allocation, goals, statistics } = state.dashboard;
  const positive = summary.change >= 0;
  const total = summary.assets + summary.liabilities || 1;
  main.innerHTML = `
    <section class="hero-card">
      <div class="hero-copy">
        <span class="eyebrow">◉ Wartość netto</span>
        <h1>${summaryMoney.format(summary.netWorth)}</h1>
        <div class="change ${positive ? "positive" : "negative"}">${positive ? "↗" : "↘"} ${signed(summary.change)} (${Math.abs(summary.changePercent)}%) <small>od ostatniej aktualizacji</small></div>
      </div>
      <div class="hero-divider"></div>
      <div class="hero-stat"><span>Aktywa</span><strong>${summaryMoney.format(summary.assets)}</strong><small><i class="dot asset"></i>${Math.round(summary.assets / total * 100)}% całości</small></div>
      <div class="hero-stat"><span>Zobowiązania</span><strong>${summaryMoney.format(summary.liabilities)}</strong><small><i class="dot debt"></i>${Math.round(summary.liabilities / total * 100)}% całości</small></div>
    </section>
    <section class="statistics-panel" aria-label="Statystyki wartości netto">
      <header><div><span class="eyebrow">◇ Statystyki</span><h2>Twój majątek w liczbach</h2></div><small>na podstawie zapisanej historii</small></header>
      <div class="statistics-grid">
        <article><span>Ostatnie 30 dni</span>${statisticChange(statistics.change30Days)}</article>
        <article><span>Ostatnie 6 miesięcy</span>${statisticChange(statistics.change6Months)}</article>
        <article><span>Ostatnie 12 miesięcy</span>${statisticChange(statistics.change12Months)}</article>
        <article><span>Średnio miesięcznie</span>${statistics.averageMonthlyChange == null ? `<strong>—</strong><small>Za mało danych</small>` : `<strong class="${statistics.averageMonthlyChange >= 0 ? "positive" : "negative"}">${signed(statistics.averageMonthlyChange)}</strong><small>${statistics.growingMonths} z ${statistics.observedMonths} mies. na plusie</small>`}</article>
        <article><span>Najlepszy miesiąc</span>${statistics.bestMonth ? `<strong class="${statistics.bestMonth.amount >= 0 ? "positive" : "negative"}">${signed(statistics.bestMonth.amount)}</strong><small>${monthLabel(statistics.bestMonth.month)}</small>` : `<strong>—</strong><small>Za mało danych</small>`}</article>
        <article><span>Miesiące ze wzrostem</span><strong>${statistics.observedMonths ? `${statistics.growingMonths} / ${statistics.observedMonths}` : "—"}</strong><small>${statistics.observedMonths ? `${Math.round(statistics.growingMonths / statistics.observedMonths * 100)}% badanego okresu` : "Za mało danych"}</small></article>
        <article><span>Zmiana zadłużenia · 12 mies.</span>${statistics.liabilityChange12Months ? `<strong class="${statistics.liabilityChange12Months.amount <= 0 ? "positive" : "negative"}">${signed(statistics.liabilityChange12Months.amount)}</strong><small>${statistics.liabilityChange12Months.amount <= 0 ? "zadłużenie spadło" : "zadłużenie wzrosło"}</small>` : `<strong>—</strong><small>Za mało danych</small>`}</article>
        <article><span>Prognoza za 12 miesięcy</span>${statistics.projectedNetWorth12Months == null ? `<strong>—</strong><small>Za mało danych</small>` : `<strong class="${statistics.projectedNetWorth12Months >= 0 ? "" : "negative"}">${money.format(statistics.projectedNetWorth12Months)}</strong><small>${statistics.isAtRecord ? "obecnie rekord wartości netto" : `rekord: ${money.format(statistics.recordNetWorth)}`}</small>`}</article>
      </div>
    </section>
    <div class="main-grid">
      <section class="panel chart-panel">
        <header class="panel-head"><div><h2>Wartość netto w czasie</h2><p>Aktywa pomniejszone o zobowiązania</p></div>
          <div class="range-control">
            <button data-range="6m" class="${state.chartRange === "6m" ? "active" : ""}">6M</button>
            <button data-range="1y" class="${state.chartRange === "1y" ? "active" : ""}">1R</button>
            <button data-range="max" class="${state.chartRange === "max" ? "active" : ""}">MAX</button>
          </div>
        </header>
        <div class="canvas-wrap"><canvas id="netWorthChart"></canvas></div>
      </section>
      <section class="panel allocation-panel">
        <header class="panel-head"><div><h2>Struktura aktywów</h2><p>Według kategorii</p></div><button class="text-button" data-view="accounts">Szczegóły ›</button></header>
        <div class="donut-wrap"><canvas id="allocationChart"></canvas><div class="donut-center"><strong>${allocation.length}</strong><small>kategorii</small></div></div>
        <div class="legend">${allocation.slice(0, 4).map((item) => `<div><span><i style="background:${esc(item.color)}"></i>${esc(item.name)}</span><strong>${Math.round(item.value / (summary.assets || 1) * 100)}%</strong></div>`).join("")}</div>
      </section>
    </div>
    <section class="panel accounts-panel">
      <header class="panel-head"><div><h2>Konta</h2><p>${accounts.length} aktywnych kont</p></div><button class="text-button" data-view="accounts">Zobacz wszystkie ›</button></header>
      <div class="table-head"><span>Konto</span><span>Typ</span><span>Aktualizacja</span><span>Zmiana</span><span>Saldo</span><span></span></div>
      ${accounts.slice(0, 5).map(accountRow).join("")}
    </section>
    ${goals.length ? `<section class="panel goals-preview"><header class="panel-head"><div><h2>Cele finansowe</h2><p>Postęp względem wartości netto</p></div><button class="text-button" data-view="goals">Zobacz cele ›</button></header>${goals.slice(0, 2).map((goal) => goalCard(goal, true)).join("")}</section>` : ""}`;
  requestAnimationFrame(() => {
    const timeline = aggregateTimelineForChart(
      filterTimelineByRange(state.dashboard.timeline, state.chartRange),
      state.chartRange,
    );
    drawLineChart($("#netWorthChart"), timeline, "netWorth", "#2f6f5e");
    drawDonut($("#allocationChart"), allocation.map((item) => item.value), allocation.map((item) => item.color));
  });
}

function accountRow(account) {
  const favorable = account.kind === "asset" ? account.change >= 0 : account.change <= 0;
  return `<div class="table-row">
    <button class="account-name" data-history="${account.id}">
      <span class="account-icon" style="color:${esc(account.color)};background:${esc(account.color)}18">${accountGlyph(account.category)}</span>
      <span><strong>${esc(account.name)} ${account.stale ? `<i class="stale-badge">Nieaktualne ${account.staleDays} d.</i>` : ""}</strong><small>${esc(account.institution)}</small></span>
    </button>
    <span><i class="type-pill ${account.kind}">${account.kind === "asset" ? "Aktywo" : "Zobowiązanie"}</i></span>
    <span class="muted">${account.last_updated ? dateLabel(account.last_updated) : "—"}</span>
    <span class="${favorable ? "positive" : "negative"}">${signed(account.change)}</span>
    <strong class="balance">${money.format(account.current_balance)}</strong>
    <button class="row-action" data-update="${account.id}" aria-label="Aktualizuj ${esc(account.name)}">✎</button>
  </div>`;
}

function compactGoalCard(goal) {
  return `<article class="goal-card ${goal.completed ? "completed" : ""}">
    <div class="goal-head"><span><strong>${esc(goal.name)}</strong><small>Start: ${dateLabel(goal.startDate)}${goal.targetDate ? ` · termin: ${dateLabel(goal.targetDate)}` : " · bez terminu"}</small></span><strong>${goal.progress}%</strong></div>
    <div class="goal-progress"><i style="width:${goal.progress}%"></i></div>
    <div class="goal-foot"><span>Do celu: <strong>${money.format(goal.remainingAmount)}</strong></span><span>cel: ${money.format(goal.targetAmount)}</span></div>
    <div class="goal-actions"><button data-goal-complete="${goal.id}">${goal.completed ? "Przywróć" : "Oznacz jako osiągnięty"}</button><button class="danger-link" data-goal-delete="${goal.id}">Usuń</button></div>
  </article>`;
}

function goalCard(goal, compact = false) {
  if (compact) return compactGoalCard(goal);
  const [statusLabel, statusTone] = goalStatus(goal);
  const gainedTone = goal.gainedAmount >= 0 ? "positive" : "negative";
  return `<article class="goal-card goal-card-detailed ${goal.completed ? "completed" : ""}">
    <header class="goal-title-row">
      <div><span class="goal-status ${statusTone}">${statusLabel}</span><h2>${esc(goal.name)}</h2><small>Start: ${dateLabel(goal.startDate)}${goal.targetDate ? ` · termin: ${dateLabel(goal.targetDate)}` : " · bez terminu"}</small></div>
      <strong class="goal-percent">${goal.progress}%</strong>
    </header>
    <div class="goal-detail-grid">
      <section class="goal-destination">
        <span>Do celu zostało</span>
        <strong>${money.format(goal.remainingAmount)}</strong>
        <div class="goal-journey" aria-label="Postęp finansowy ${goal.progress}%">
          <i style="width:${goal.progress}%"></i>
          <b style="left:${Math.max(1, Math.min(99, goal.progress))}%"></b>
          <em style="left:25%"></em><em style="left:50%"></em><em style="left:75%"></em>
        </div>
        <div class="goal-points"><span><small>Start</small>${money.format(goal.startAmount)}</span><span><small>Teraz</small>${money.format(goal.currentAmount)}</span><span><small>Cel</small>${money.format(goal.targetAmount)}</span></div>
      </section>
      <section class="goal-metrics">
        <div><span>Od startu</span><strong class="${gainedTone}">${signed(goal.gainedAmount)}</strong></div>
        <div><span>Średnie tempo</span><strong>${goal.monthlyPace == null ? "—" : `${signed(goal.monthlyPace)} / mies.`}</strong></div>
        <div><span>Wymagane tempo</span><strong>${goal.requiredMonthlyChange == null ? "—" : `${money.format(goal.requiredMonthlyChange)} / mies.`}</strong></div>
        <div><span>Prognozowane osiągnięcie</span><strong>${goal.estimatedCompletionDate ? dateLabel(goal.estimatedCompletionDate) : "—"}</strong></div>
      </section>
    </div>
    ${goal.targetDate ? `<div class="goal-pace-bars"><div><span>Postęp finansowy <strong>${goal.progress}%</strong></span><i><b style="width:${goal.progress}%"></b></i></div><div><span>Upływ czasu <strong>${goal.timeProgress}%</strong></span><i class="time"><b style="width:${goal.timeProgress}%"></b></i></div></div>` : ""}
    <section class="goal-chart-wrap"><header><strong>Rzeczywistość a plan</strong><span><i></i> wartość netto ${goal.targetDate ? "<i></i> plan" : ""}</span></header><canvas id="goalChart-${goal.id}"></canvas></section>
    <div class="goal-actions"><button data-goal-complete="${goal.id}">${goal.completed ? "Przywróć" : "Oznacz jako osiągnięty"}</button><button class="danger-link" data-goal-delete="${goal.id}">Usuń</button></div>
  </article>`;
}

function renderGoals() {
  const goals = state.dashboard.goals || [];
  const active = goals.filter((goal) => !goal.completed);
  const completed = goals.length - active.length;
  const closest = active.length ? Math.max(...active.map((goal) => goal.progress)) : 0;
  main.innerHTML = `
    <div class="view-heading"><div><h1>Cele finansowe</h1><p>Konkretny kierunek dla rosnącej wartości netto.</p></div><button class="button primary" id="addGoal">＋ Nowy cel</button></div>
    ${goals.length ? `<section class="goals-summary"><div><span>Aktywne cele</span><strong>${active.length}</strong></div><div><span>Osiągnięte</span><strong>${completed}</strong></div><div><span>Najbliższy cel</span><strong>${closest}%</strong></div></section>` : ""}
    <section class="goals-grid">${goals.length ? goals.map((goal) => goalCard(goal)).join("") : `<div class="empty-state"><strong>Nie masz jeszcze celu</strong><p>Dodaj docelową wartość netto i obserwuj postęp.</p></div>`}</section>`;
  requestAnimationFrame(() => goals.forEach((goal) => drawGoalChart($(`#goalChart-${goal.id}`), goal)));
}

async function renderAccounts(query = "") {
  if (!state.allAccounts) {
    try {
      state.allAccounts = await api("/accounts?include_archived=true");
    } catch {
      state.allAccounts = state.dashboard.accounts;
    }
  }
  const archivedCount = state.allAccounts.filter((account) => account.archived).length;
  const source = state.showArchived
    ? state.allAccounts.filter((account) => account.archived)
    : state.allAccounts.filter((account) => !account.archived);
  const accounts = source.filter((account) =>
    `${account.name} ${account.institution} ${account.category}`.toLowerCase().includes(query.toLowerCase())
  );
  main.innerHTML = `
    <div class="view-heading"><div><h1>${state.showArchived ? "Archiwum kont" : "Wszystkie konta"}</h1><p>${state.showArchived ? "Zamknięte konta z zachowaną historią." : "Aktywa i zobowiązania w jednym miejscu."}</p></div><div class="view-actions"><button class="button secondary" id="toggleArchived">${state.showArchived ? "← Aktywne konta" : `Archiwum (${archivedCount})`}</button><button class="button primary" id="addAccountView">＋ Nowe konto</button></div></div>
    <label class="search-box">⌕ <input id="accountSearch" value="${esc(query)}" placeholder="Szukaj konta lub instytucji…"></label>
    <section class="account-grid">${accounts.length ? accounts.map((account) => `
      <article class="account-card ${account.archived ? "archived-card" : ""}">
        <div class="account-card-top"><span class="account-icon" style="color:${esc(account.color)};background:${esc(account.color)}18">${accountGlyph(account.category)}</span><i class="type-pill ${account.kind}">${account.kind === "asset" ? "Aktywo" : "Zobowiązanie"}</i></div>
        <span class="institution">${esc(account.institution)}</span><h3>${esc(account.name)} ${account.stale ? `<i class="stale-badge">Nieaktualne</i>` : ""}</h3>
        <div class="account-card-balance"><strong>${money.format(account.current_balance)}</strong></div>
        <footer class="account-card-foot"><span>${esc(account.category)}${account.stale ? ` · ${account.staleDays} dni po terminie` : ""}</span><div class="card-actions"><button data-history="${account.id}">⌁ Wykres</button><button data-edit-account="${account.id}">✎ ${account.archived ? "Przywróć" : "Edytuj"}</button>${account.archived ? "" : `<button data-update="${account.id}">Aktualizuj ›</button>`}</div></footer>
      </article>`).join("") : `<div class="empty-state"><strong>${state.showArchived ? "Archiwum jest puste" : "Brak pasujących kont"}</strong><p>${state.showArchived ? "Zarchiwizowane konta pojawią się tutaj." : "Zmień wyszukiwanie albo dodaj nowe konto."}</p></div>`}</section>`;
  const input = $("#accountSearch");
  input?.addEventListener("input", (event) => renderAccounts(event.target.value));
  if (query) {
    input.focus();
    input.setSelectionRange(query.length, query.length);
  }
}

function applyActivityPreset(preset) {
  state.activity.filters.preset = preset;
  state.activity.filters.to = preset === "all" ? "" : isoDateOffset(0);
  state.activity.filters.from = preset === "all" ? "" : isoDateOffset(-(Number(preset) - 1));
}

function activitySourceLabel(source) {
  return ({
    "actual-budget": "Actual Budget",
    manual: "Ręcznie",
    import: "Import",
    seed: "Dane demo",
  })[source] || source || "Inne";
}

async function renderActivity() {
  if (!state.activity.filters.from && state.activity.filters.preset === "30") applyActivityPreset("30");
  if (!state.allAccounts) {
    try { state.allAccounts = await api("/accounts?include_archived=true"); }
    catch { state.allAccounts = state.dashboard.accounts; }
  }
  if (state.view !== "activity") return;
  const filters = state.activity.filters;
  const accounts = [...state.allAccounts].sort((a, b) => a.name.localeCompare(b.name, "pl"));
  main.innerHTML = `
    <div class="view-heading"><div><h1>Aktywność</h1><p>Pełna historia zapisów salda — każda aktualizacja osobno.</p></div></div>
    <section class="panel activity-toolbar">
      <div class="activity-presets" aria-label="Szybki zakres dat">
        ${[["7", "7 dni"], ["30", "30 dni"], ["90", "90 dni"], ["all", "Całość"]].map(([value, label]) => `<button type="button" data-activity-preset="${value}" class="${filters.preset === value ? "active" : ""}">${label}</button>`).join("")}
      </div>
      <form id="activityFilters" class="activity-filters">
        <label>Od<input type="date" name="from" value="${esc(filters.from)}"></label>
        <label>Do<input type="date" name="to" value="${esc(filters.to)}"></label>
        <label>Konto<select name="accountId"><option value="">Wszystkie konta</option>${accounts.map((account) => `<option value="${account.id}" ${String(account.id) === filters.accountId ? "selected" : ""}>${esc(account.name)}${account.archived ? " (archiwalne)" : ""}</option>`).join("")}</select></label>
        <label>Źródło<select name="source"><option value="">Wszystkie źródła</option>${[["actual-budget", "Actual Budget"], ["manual", "Ręcznie"], ["import", "Import"], ["seed", "Dane demo"]].map(([value, label]) => `<option value="${value}" ${value === filters.source ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <button class="button primary" type="submit">Filtruj</button>
        <button class="button secondary" type="button" id="resetActivityFilters">Wyczyść</button>
      </form>
    </section>
    <div id="activityResults"><div class="skeleton activity-skeleton"></div></div>`;
  loadActivity(true);
}

async function loadActivity(reset = false) {
  const requestId = ++state.activity.requestId;
  state.activity.loading = true;
  if (reset) {
    state.activity.page = 1;
    state.activity.items = [];
  }
  const results = $("#activityResults");
  if (reset && results) results.innerHTML = `<div class="skeleton activity-skeleton"></div>`;
  const params = new URLSearchParams({
    page: String(state.activity.page),
    page_size: String(state.activity.pageSize),
  });
  const { from, to, accountId, source } = state.activity.filters;
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  if (accountId) params.set("account_id", accountId);
  if (source) params.set("source", source);
  try {
    const payload = await api(`/activity?${params}`);
    if (state.view !== "activity" || requestId !== state.activity.requestId) return;
    state.activity.items = reset ? payload.items : [...state.activity.items, ...payload.items];
    state.activity.total = payload.total;
    state.activity.hasMore = payload.hasMore;
    renderActivityResults();
  } catch (error) {
    if (requestId === state.activity.requestId && results) results.innerHTML = `<section class="insight"><strong>Nie udało się pobrać aktywności</strong><p>${esc(error.message)}</p></section>`;
  } finally {
    if (requestId === state.activity.requestId) state.activity.loading = false;
  }
}

function renderActivityResults() {
  const results = $("#activityResults");
  if (!results) return;
  if (!state.activity.items.length) {
    results.innerHTML = `<section class="empty-state activity-empty"><strong>Brak zapisów w tym zakresie</strong><p>Zmień filtry albo wybierz dłuższy okres.</p></section>`;
    return;
  }
  let previousDate = null;
  const rows = state.activity.items.map((item) => {
    const day = item.date !== previousDate ? `<div class="activity-day"><span>${dateLabel(item.date)}</span></div>` : "";
    previousDate = item.date;
    const favorable = item.change == null || (item.kind === "asset" ? item.change >= 0 : item.change <= 0);
    const change = item.change == null
      ? `<span class="activity-first">Pierwszy wpis</span>`
      : `<span class="activity-change ${favorable ? "positive" : "negative"}">${signedDetail(item.change)}</span><small>${detailMoney.format(item.previousAmount)} → ${detailMoney.format(item.amount)}</small>`;
    return `${day}<article class="activity-item ${item.important ? "important-change" : ""}">
      <span class="activity-icon ${item.kind}">${item.important ? "★" : "↻"}</span>
      <div class="activity-copy"><button data-history="${item.accountId}">${esc(item.account)}</button><small>${esc(item.institution)} · ${esc(item.note || "Zapis salda")}</small></div>
      <span class="source-badge">${esc(activitySourceLabel(item.source))}</span>
      <div class="activity-delta">${change}</div>
      <div class="activity-amount"><strong>${detailMoney.format(item.amount)}</strong></div>
    </article>`;
  }).join("");
  results.innerHTML = `<section class="panel activity-list">${rows}</section>
    <footer class="activity-footer"><span>Wyświetlono ${state.activity.items.length} z ${state.activity.total} zapisów</span>${state.activity.hasMore ? `<button class="button secondary" id="loadMoreActivity">Pokaż kolejne</button>` : ""}</footer>`;
}

function reportTabs() {
  return `<div class="report-tabs"><button data-report-mode="monthly" class="${state.reportMode === "monthly" ? "active" : ""}">Miesięczny</button><button data-report-mode="annual" class="${state.reportMode === "annual" ? "active" : ""}">Roczny</button></div>`;
}

function renderReport() {
  return state.reportMode === "annual" ? renderAnnualReport() : renderMonthlyReport();
}

async function renderMonthlyReport() {
  const months = [...new Set(state.dashboard.timeline.map((item) => item.date.slice(0, 7)))].reverse();
  const earliestMonth = months.at(-1) || state.selectedMonth;
  const latestMonth = months[0] || state.selectedMonth;
  main.innerHTML = `<div class="skeleton" style="height:620px"></div>`;
  try {
    const report = await api(`/reports/monthly?month=${state.selectedMonth}`);
    const total = report.assets + report.liabilities || 1;
    const assetShare = report.assets / total * 100;
    const liabilityShare = report.liabilities / total * 100;
    const timeline = filterTimelineByRange(
      state.dashboard.timeline.filter((item) => item.date.slice(0, 7) <= state.selectedMonth),
      "6m",
    );
    main.innerHTML = `
      <div class="view-heading">
        <div><h1 style="text-transform:capitalize">${monthFormatter.format(dateValue(`${state.selectedMonth}-01`))}</h1><p>Historyczny raport na koniec wybranego miesiąca.</p>${reportTabs()}</div>
        <div class="report-actions">
          <div class="month-navigator" aria-label="Wybór miesiąca raportu">
            <button id="previousReportMonth" aria-label="Poprzedni miesiąc" ${state.selectedMonth <= earliestMonth ? "disabled" : ""}>‹</button>
            <label class="month-picker">▤ <input type="month" id="reportMonth" value="${state.selectedMonth}" min="${earliestMonth}" max="${latestMonth}" aria-label="Miesiąc raportu"></label>
            <button id="nextReportMonth" aria-label="Następny miesiąc" ${state.selectedMonth >= latestMonth ? "disabled" : ""}>›</button>
          </div>
          <button class="button secondary" id="printReport">⌑ Drukuj / PDF</button>
        </div>
      </div>
      <section class="report-hero"><div><span>Wartość netto na koniec okresu</span><h2>${money.format(report.netWorth)}</h2><small class="${report.change >= 0 ? "positive" : "negative"}">${report.change >= 0 ? "↗" : "↘"} ${signed(report.change)} w tym miesiącu</small></div><div class="report-score"><span>Zmiana m/m</span><strong>${report.changePercent >= 0 ? "+" : ""}${report.changePercent}%</strong><small class="${report.change >= 0 ? "positive" : "negative"}">${signed(report.change)} m/m</small></div></section>
      <div class="report-metrics">
        ${metric("Aktywa", report.assets, report.assetChange, report.assetChange >= 0)}
        ${metric("Zobowiązania", report.liabilities, report.liabilityChange, report.liabilityChange <= 0)}
        <article class="metric"><span>Zmiana rok do roku</span><strong>${report.yearOverYearPercent >= 0 ? "+" : ""}${report.yearOverYearPercent}%</strong><small class="${report.yearOverYear >= 0 ? "positive" : "negative"}">${signed(report.yearOverYear)} r/r</small></article>
      </div>
      <section class="panel balance-sheet">
        <header class="panel-head"><div><h2>Aktywa vs zobowiązania</h2><p>Struktura bilansu dla wybranego miesiąca</p></div><p>Suma pozycji: <strong>${money.format(total)}</strong></p></header>
        <div class="balance-sheet-content">
          <div class="balance-donut"><canvas id="balanceDonut"></canvas><div class="donut-center"><strong>${money.format(report.netWorth)}</strong><small>wartość netto</small></div></div>
          <div class="balance-bars">
            ${shareBar("Aktywa", report.assets, assetShare, false)}
            ${shareBar("Zobowiązania", report.liabilities, liabilityShare, true)}
            <div class="ratio"><span>Na każde 100 zł aktywów przypada</span><strong>${money.format(report.assets ? report.liabilities / report.assets * 100 : 0)} zobowiązań</strong></div>
          </div>
        </div>
      </section>
      <div class="report-grid">
        <section class="panel"><header class="panel-head"><div><h2>Trend ostatnich 6 miesięcy</h2><p>Zmiana wartości netto</p></div></header><div class="canvas-wrap"><canvas id="reportChart"></canvas></div></section>
        <section class="panel"><header class="panel-head"><div><h2>Wpływ na wynik</h2><p>Największe zmiany kont</p></div></header><div class="contributors">${report.accounts.slice(0, 5).map((account) => `<div class="contributor"><span class="account-icon" style="color:${esc(account.color)};background:${esc(account.color)}18">${accountGlyph(account.category)}</span><span><strong>${esc(account.name)}</strong><small>${account.kind === "asset" ? "Aktywo" : "Zobowiązanie"}</small></span><strong class="${account.contribution >= 0 ? "positive" : "negative"}">${signed(account.contribution)}</strong></div>`).join("")}</div></section>
      </div>
      <section class="insight"><strong>✦ WNIOSEK MIESIĄCA</strong><p>Wartość netto ${report.change >= 0 ? "wzrosła" : "spadła"} o ${money.format(Math.abs(report.change))}. ${report.liabilityChange < 0 ? `Zadłużenie zmniejszyło się o ${money.format(Math.abs(report.liabilityChange))}.` : "Największy wpływ na wynik miały zmiany aktywów."}</p></section>`;
    requestAnimationFrame(() => {
      drawDonut($("#balanceDonut"), [report.assets, report.liabilities], ["#2f6f5e", "#a95342"]);
      drawLineChart($("#reportChart"), timeline, "netWorth", "#2f6f5e");
    });
  } catch (error) {
    main.innerHTML = `<section class="insight"><strong>Nie udało się przygotować raportu</strong><p>${esc(error.message)}</p></section>`;
  }
}

async function renderAnnualReport() {
  main.innerHTML = `<div class="skeleton" style="height:620px"></div>`;
  try {
    const report = await api(`/reports/annual?year=${state.selectedYear}`);
    const total = report.assets + report.liabilities || 1;
    main.innerHTML = `
      <div class="view-heading">
        <div><h1>Raport za ${report.year} rok</h1><p>Podsumowanie dwunastu miesięcy i porównanie rok do roku.</p>${reportTabs()}</div>
        <div class="report-actions"><div class="year-navigator"><button id="previousReportYear">‹</button><strong>${report.year}</strong><button id="nextReportYear" ${report.year >= new Date().getFullYear() ? "disabled" : ""}>›</button></div><button class="button secondary" id="printReport">⌑ Drukuj / PDF</button></div>
      </div>
      <section class="report-hero"><div><span>Wartość netto na koniec roku</span><h2>${money.format(report.netWorth)}</h2><small class="${report.change >= 0 ? "positive" : "negative"}">${signed(report.change)} w ciągu roku</small></div><div class="report-score"><span>Zmiana r/r</span><strong>${report.yearOverYearPercent >= 0 ? "+" : ""}${report.yearOverYearPercent}%</strong><small>poprzedni rok: ${money.format(report.previousYearNetWorth)}</small></div></section>
      <div class="report-metrics">
        <article class="metric"><span>Aktywa</span><strong>${money.format(report.assets)}</strong><small>${(report.assets / total * 100).toFixed(1)}% bilansu</small></article>
        <article class="metric"><span>Zobowiązania</span><strong>${money.format(report.liabilities)}</strong><small>${(report.liabilities / total * 100).toFixed(1)}% bilansu</small></article>
        <article class="metric"><span>Wynik roku</span><strong>${signed(report.change)}</strong><small>${report.changePercent >= 0 ? "+" : ""}${report.changePercent}%</small></article>
      </div>
      <section class="panel"><header class="panel-head"><div><h2>Przebieg roku</h2><p>Wartość netto na koniec każdego miesiąca</p></div></header><div class="canvas-wrap"><canvas id="annualChart"></canvas></div></section>
      <section class="panel annual-table"><header class="panel-head"><div><h2>Miesiąc po miesiącu</h2><p>Zmiana miesięczna wartości netto</p></div></header>${report.months.map((item) => `<div><span>${monthFormatter.format(dateValue(item.date))}</span><strong>${money.format(item.netWorth)}</strong><span class="${item.change == null ? "muted" : item.change >= 0 ? "positive" : "negative"}">${item.change == null ? "—" : signed(item.change)}</span></div>`).join("")}</section>`;
    requestAnimationFrame(() => drawLineChart($("#annualChart"), report.months, "netWorth", "#2f6f5e"));
  } catch (error) {
    main.innerHTML = `<section class="insight"><strong>Nie udało się przygotować raportu rocznego</strong><p>${esc(error.message)}</p></section>`;
  }
}

function metric(label, value, change, favorable) {
  return `<article class="metric"><span>${label}</span><strong>${money.format(value)}</strong><small class="${favorable ? "positive" : "negative"}">${signed(change)} m/m</small></article>`;
}
function shareBar(label, value, share, debt) {
  return `<div><div class="bar-label"><span><i class="dot ${debt ? "debt" : "asset"}"></i>${label}</span><strong>${share.toFixed(1)}%</strong></div><div class="share-bar ${debt ? "debt" : ""}"><i style="width:${share}%"></i></div><small>${money.format(value)}</small></div>`;
}

function moveReportMonth(offset) {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const target = new Date(year, month - 1 + offset, 1);
  const value = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  const picker = $("#reportMonth");
  if (picker && value >= picker.min && value <= picker.max) {
    state.selectedMonth = value;
    renderReport();
  }
}

function setupCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, rect.width * ratio);
  canvas.height = Math.max(1, rect.height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  return { context, width: rect.width, height: rect.height };
}
function drawLineChart(canvas, items, key, color, valueFormatter = compactMoney, tooltipFormatter = detailMoney) {
  const setup = setupCanvas(canvas);
  if (!setup || !items.length) return;
  const { context: ctx, width, height } = setup;
  const pad = { left: 82, right: 12, top: 22, bottom: 30 };
  const values = items.map((item) => item[key]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const spread = max - min || Math.abs(max) * .1 || 1;
  min -= spread * .15; max += spread * .15;
  const timestamps = items.map((item) => dateValue(item.date || item.snapshot_date).getTime());
  const firstTimestamp = Math.min(...timestamps);
  const lastTimestamp = Math.max(...timestamps);
  const timeSpread = lastTimestamp - firstTimestamp;
  const points = items.map((item, index) => ({
    x: pad.left + (width - pad.left - pad.right) * (
      items.length === 1 ? .5 : timeSpread ? (timestamps[index] - firstTimestamp) / timeSpread : index / (items.length - 1)
    ),
    y: pad.top + (height - pad.top - pad.bottom) * (1 - (item[key] - min) / (max - min)),
  }));
  const monthTicks = [];
  const seenMonths = new Set();
  items.forEach((item, index) => {
    const month = (item.date || item.snapshot_date).slice(0, 7);
    if (seenMonths.has(month)) return;
    seenMonths.add(month);
    monthTicks.push({ month, point: points[index] });
  });
  const maxLabels = Math.max(2, Math.floor((width - pad.left - pad.right) / 100));
  const monthEvery = Math.max(1, Math.ceil(monthTicks.length / maxLabels));

  function render(activeIndex = null) {
    ctx.clearRect(0, 0, width, height);
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#666c68";
    ctx.strokeStyle = "#e9e8e2";
    ctx.lineWidth = 1;
    for (let index = 0; index < 4; index++) {
      const y = pad.top + (height - pad.top - pad.bottom) * index / 3;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      const value = max - (max - min) * index / 3;
      ctx.fillText(valueFormatter.format(value), 2, y + 4);
    }

    const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    gradient.addColorStop(0, `${color}40`); gradient.addColorStop(1, `${color}00`);
    ctx.beginPath(); ctx.moveTo(points[0].x, height - pad.bottom);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points.at(-1).x, height - pad.bottom); ctx.closePath();
    ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.stroke();

    monthTicks.forEach((tick, index) => {
      if (index % monthEvery && index !== monthTicks.length - 1) return;
      ctx.fillStyle = "#666c68"; ctx.textAlign = "center";
      ctx.fillText(tick.month, tick.point.x, height - 7);
    });

    if (activeIndex == null) return;
    const point = points[activeIndex];
    const item = items[activeIndex];
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = `${color}80`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(point.x, pad.top); ctx.lineTo(point.x, height - pad.bottom); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "white"; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();

    const lines = [dateLabel(item.date || item.snapshot_date), tooltipFormatter.format(item[key])];
    ctx.font = "bold 13px sans-serif";
    const tooltipWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 20;
    const tooltipHeight = 48;
    let tooltipX = point.x + 12;
    if (tooltipX + tooltipWidth > width - pad.right) tooltipX = point.x - tooltipWidth - 12;
    const tooltipY = Math.max(pad.top, Math.min(point.y - tooltipHeight / 2, height - pad.bottom - tooltipHeight));
    ctx.fillStyle = "#20332c";
    ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    ctx.textAlign = "left";
    ctx.fillStyle = "#c9d7d1"; ctx.font = "12px sans-serif";
    ctx.fillText(lines[0], tooltipX + 10, tooltipY + 17);
    ctx.fillStyle = "white"; ctx.font = "bold 13px sans-serif";
    ctx.fillText(lines[1], tooltipX + 10, tooltipY + 36);
  }

  render();
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    if (mouseX < pad.left || mouseX > width - pad.right || mouseY < pad.top || mouseY > height - pad.bottom) {
      render();
      return;
    }
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - mouseX) < Math.abs(points[nearest].x - mouseX)) nearest = index;
    });
    render(nearest);
  });
  canvas.addEventListener("pointerleave", () => render());
}
function drawGoalChart(canvas, goal) {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { context: ctx, width, height } = setup;
  const actual = state.dashboard.timeline
    .filter((item) => item.date >= goal.startDate)
    .map((item) => ({ date: item.date, value: item.netWorth }));
  if (!actual.length || actual[0].date !== goal.startDate) {
    actual.unshift({ date: goal.startDate, value: goal.startAmount });
  }
  const startTime = dateValue(goal.startDate).getTime();
  const latestTime = dateValue(actual.at(-1).date).getTime();
  const targetTime = goal.targetDate ? dateValue(goal.targetDate).getTime() : latestTime;
  const endTime = Math.max(startTime + 86400000, latestTime, targetTime);
  const values = [...actual.map((item) => item.value), goal.startAmount, goal.targetAmount];
  let min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || Math.abs(max) * .1 || 1;
  min -= spread * .14; max += spread * .14;
  const pad = { left: 8, right: 8, top: 13, bottom: 16 };
  const x = (value) => pad.left + (width - pad.left - pad.right) * (value - startTime) / (endTime - startTime);
  const y = (value) => pad.top + (height - pad.top - pad.bottom) * (1 - (value - min) / (max - min));

  ctx.strokeStyle = "#ecece6"; ctx.lineWidth = 1;
  for (let index = 0; index < 3; index++) {
    const gridY = pad.top + (height - pad.top - pad.bottom) * index / 2;
    ctx.beginPath(); ctx.moveTo(pad.left, gridY); ctx.lineTo(width - pad.right, gridY); ctx.stroke();
  }
  ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = "#d3a349"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.left, y(goal.targetAmount)); ctx.lineTo(width - pad.right, y(goal.targetAmount)); ctx.stroke();
  if (goal.targetDate) {
    ctx.beginPath(); ctx.moveTo(x(startTime), y(goal.startAmount)); ctx.lineTo(x(targetTime), y(goal.targetAmount)); ctx.stroke();
  }
  ctx.restore();

  const points = actual.map((item) => ({ x: x(dateValue(item.date).getTime()), y: y(item.value) }));
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, "#2f6f5e30"); gradient.addColorStop(1, "#2f6f5e00");
  ctx.beginPath(); ctx.moveTo(points[0].x, height - pad.bottom);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = "#2f6f5e"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
  const last = points.at(-1); ctx.beginPath(); ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "white"; ctx.fill(); ctx.strokeStyle = "#2f6f5e"; ctx.lineWidth = 2.5; ctx.stroke();
}
function drawDonut(canvas, values, colors) {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { context: ctx, width, height } = setup;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const centerX = width / 2, centerY = height / 2, radius = Math.min(width, height) * .38;
  let start = -Math.PI / 2;
  values.forEach((value, index) => {
    const angle = Math.max(0, value) / total * Math.PI * 2;
    ctx.beginPath(); ctx.arc(centerX, centerY, radius, start + .025, start + angle - .025);
    ctx.strokeStyle = colors[index] || "#789"; ctx.lineWidth = 23; ctx.lineCap = "butt"; ctx.stroke();
    start += angle;
  });
}

function renderNotifications() {
  const reminders = [...state.dashboard.accounts]
    .filter((account) => account.next_update)
    .sort((a, b) => a.next_update.localeCompare(b.next_update))
    .slice(0, 5);
  const overdue = reminders.filter((account) => account.stale);
  $("#notificationDot").hidden = overdue.length === 0;
  $("#notificationPanel").innerHTML = `<div class="notification-head"><strong>Przypomnienia</strong><small>Planowane aktualizacje sald</small></div>
    ${reminders.map((account) => `<button class="notification-item ${account.stale ? "overdue" : ""}" data-update="${account.id}"><span>${account.stale ? "!" : "↻"}</span><span><strong>${esc(account.name)}</strong><small>${account.stale ? `${account.staleDays} dni po terminie` : `Aktualizacja: ${dateLabel(account.next_update)}`}</small></span><span>›</span></button>`).join("")}
    <div class="notification-tip">${overdue.length ? `${overdue.length} kont wymaga aktualizacji.` : "Wszystkie konta są aktualne."}</div>`;
}

function findAccount(accountId) {
  return (state.allAccounts || []).find((item) => item.id === Number(accountId))
    || state.dashboard.accounts.find((item) => item.id === Number(accountId))
    || (state.selectedAccount?.id === Number(accountId) ? state.selectedAccount : null);
}

function openAccountModal() {
  $("#accountForm").reset();
  setAccountKind("asset");
  $("#openingCurrency").textContent = "PLN";
  showModal("accountModal");
}
function setAccountKind(kind) {
  $("#accountForm [name=kind]").value = kind;
  $$(".kind-toggle button").forEach((button) => button.classList.toggle("active", button.dataset.kind === kind));
  const categories = kind === "asset"
    ? ["Gotówka", "Oszczędności", "Inwestycje", "Nieruchomości", "Inne"]
    : ["Kredyty", "Karty", "Pożyczki", "Inne"];
  $("#categorySelect").innerHTML = categories.map((category) => `<option>${category}</option>`).join("");
}
function openUpdateModal(accountId) {
  const accounts = state.dashboard.accounts;
  $("#updateAccount").innerHTML = accounts.map((account) => `<option value="${account.id}">${esc(account.name)} · ${nativeMoney(account.native_current_balance, account.currency)}</option>`).join("");
  $("#updateAccount").value = accountId || accounts[0]?.id;
  syncUpdateAccount();
  $("#updateForm [name=snapshot_date]").value = new Date().toISOString().slice(0, 10);
  $("#updateForm [name=note]").value = "";
  $("#updateForm [name=important]").checked = false;
  $("#notificationPanel").hidden = true;
  showModal("updateModal");
}
function syncUpdateAccount() {
  const account = state.dashboard.accounts.find((item) => item.id === Number($("#updateAccount").value));
  if (!account) return;
  $("#currentBalance").textContent = nativeMoney(account.native_current_balance, account.currency);
  $("#updateCurrency").textContent = account.currency;
  $("#updateForm [name=amount]").value = account.native_current_balance;
}
async function openHistory(accountId) {
  const account = findAccount(accountId);
  if (!account) return;
  state.selectedAccount = account;
  $("#historyTitle").textContent = account.name;
  $("#historySubtitle").textContent = `${account.institution} · ${account.category}`;
  $("#historyContent").innerHTML = `<div class="skeleton" style="height:430px"></div>`;
  showModal("historyModal");
  applyHistoryRange("1y");
}

function applyHistoryRange(range) {
  const latest = state.selectedAccount?.last_updated || isoDateOffset();
  state.history.range = range;
  state.history.to = latest;
  state.history.from = range === "max"
    ? ""
    : subtractMonths(dateValue(latest), range === "3m" ? 3 : range === "6m" ? 6 : 12).toISOString().slice(0, 10);
  state.history.page = 1;
  loadAccountHistory();
}

function historyGranularity() {
  if (state.history.range === "max") return "monthly";
  if (state.history.range === "1y") return "weekly";
  if (!state.history.from || !state.history.to) return "monthly";
  const days = (dateValue(state.history.to) - dateValue(state.history.from)) / 86400000;
  return days > 550 ? "monthly" : days > 180 ? "weekly" : "daily";
}

async function loadAccountHistory() {
  const account = state.selectedAccount;
  if (!account) return;
  const params = new URLSearchParams({
    page: state.history.page,
    page_size: state.history.pageSize,
    granularity: historyGranularity(),
  });
  if (state.history.from) params.set("date_from", state.history.from);
  if (state.history.to) params.set("date_to", state.history.to);
  $("#historyContent").innerHTML = `<div class="skeleton" style="height:430px"></div>`;
  try {
    state.historyData = await api(`/accounts/${account.id}/history?${params}`);
    state.historySnapshots = state.historyData.items;
    renderAccountHistory();
  } catch (error) {
    $("#historyContent").innerHTML = `<p>${esc(error.message)}</p>`;
  }
}

function renderAccountHistory() {
  const account = state.selectedAccount;
  const data = state.historyData;
  if (!account || !data) return;
  state.history.page = data.page;
  const change = data.change;
  const percent = data.changePercent;
  const favorable = account.kind === "asset" ? change >= 0 : change <= 0;
  const accountMoney = (value) => nativeMoney(value, account.currency);
  const accountSigned = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${accountMoney(Math.abs(value))}`;
  const pageStart = (data.page - 1) * data.pageSize;
  $("#historyContent").innerHTML = `
      <div class="history-summary">
        <div><span>Aktualne saldo</span><strong>${accountMoney(account.native_current_balance)}</strong></div>
        <div><span>Zmiana w wybranym okresie</span><strong class="${favorable ? "positive" : "negative"}">${accountSigned(change)}</strong><small>${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%</small></div>
        <button class="button primary" data-update="${account.id}">↻ Aktualizuj saldo</button>
      </div>
      <div class="history-toolbar">
        <div class="history-presets" aria-label="Zakres wykresu">
          ${[["3m", "3M"], ["6m", "6M"], ["1y", "1R"], ["max", "MAX"]].map(([value, label]) => `<button type="button" data-history-range="${value}" class="${state.history.range === value ? "active" : ""}">${label}</button>`).join("")}
        </div>
        <form id="historyFilters" class="history-filters">
          <label>Od<input type="date" name="from" value="${esc(state.history.from)}"></label>
          <label>Do<input type="date" name="to" value="${esc(state.history.to)}"></label>
          <button class="button secondary" type="submit">Zastosuj</button>
        </form>
      </div>
      ${data.total ? `<div class="history-chart"><canvas id="historyChart"></canvas></div>` : `<div class="empty-state history-empty"><strong>Brak zapisów w tym okresie</strong><p>Zmień zakres albo wyczyść datę początkową.</p></div>`}
      <div class="history-table">
        <div class="history-row head"><span>Data</span><span>Notatka</span><span>Zmiana</span><span>Saldo</span><span></span></div>
        ${data.items.map((snapshot) => {
          const delta = snapshot.previousAmount == null ? 0 : snapshot.amount - snapshot.previousAmount;
          const deltaFavorable = account.kind === "asset" ? delta >= 0 : delta <= 0;
          return `<div class="history-row ${snapshot.important ? "important-change" : ""}"><span>${snapshot.important ? "★ " : ""}${dateLabel(snapshot.snapshot_date)}</span><span class="note">${esc(snapshot.note || (snapshot.source === "seed" ? "Dane demonstracyjne" : "Aktualizacja salda"))}</span><span class="${deltaFavorable ? "positive" : "negative"}">${snapshot.previousAmount == null ? "—" : accountSigned(delta)}</span><strong>${accountMoney(snapshot.amount)}</strong><button class="snapshot-action" data-edit-snapshot="${snapshot.id}" aria-label="Edytuj snapshot z ${dateLabel(snapshot.snapshot_date)}">✎</button></div>`;
        }).join("")}
      </div>
      <div class="history-pagination"><span>${data.total ? `${pageStart + 1}–${Math.min(pageStart + data.pageSize, data.total)} z ${data.total}` : "0 zapisów"}</span><div><button class="button secondary" data-history-page="prev" ${data.page <= 1 ? "disabled" : ""}>← Poprzednie</button><button class="button secondary" data-history-page="next" ${!data.hasMore ? "disabled" : ""}>Następne →</button></div></div>`;
  if (!data.total) return;
  const accountCompact = new Intl.NumberFormat("pl-PL", { notation: "compact", style: "currency", currency: account.currency, maximumFractionDigits: 1 });
  const accountDetail = new Intl.NumberFormat("pl-PL", { style: "currency", currency: account.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  requestAnimationFrame(() => drawLineChart($("#historyChart"), data.chart, "amount", account.color, accountCompact, accountDetail));
}

function openEditAccount(accountId) {
  const account = findAccount(accountId);
  if (!account) return;
  state.selectedAccount = account;
  const form = $("#editAccountForm");
  form.elements.account_id.value = account.id;
  form.elements.name.value = account.name;
  form.elements.institution.value = account.institution;
  form.elements.update_frequency.value = account.update_frequency;
  const categories = account.kind === "asset"
    ? ["Gotówka", "Oszczędności", "Inwestycje", "Nieruchomości", "Inne"]
    : ["Kredyty", "Karty", "Pożyczki", "Inne"];
  if (!categories.includes(account.category)) categories.push(account.category);
  $("#editCategorySelect").innerHTML = categories.map((category) => `<option ${category === account.category ? "selected" : ""}>${esc(category)}</option>`).join("");
  $("#editAccountSubtitle").textContent = `${account.kind === "asset" ? "Aktywo" : "Zobowiązanie"} · ${account.currency}`;
  const archiveButton = $("#archiveAccountButton");
  archiveButton.textContent = account.archived ? "Przywróć konto" : "Archiwizuj konto";
  archiveButton.classList.toggle("restore", account.archived);
  showModal("editAccountModal");
}

function openSnapshotModal(snapshotId) {
  const snapshot = state.historySnapshots.find((item) => item.id === Number(snapshotId));
  const account = state.selectedAccount;
  if (!snapshot || !account) return;
  const form = $("#snapshotForm");
  form.elements.snapshot_id.value = snapshot.id;
  form.elements.account_id.value = account.id;
  form.elements.amount.value = snapshot.amount;
  form.elements.snapshot_date.value = snapshot.snapshot_date;
  form.elements.note.value = snapshot.note || "";
  form.elements.important.checked = snapshot.important;
  $("#snapshotCurrency").textContent = account.currency;
  $("#snapshotModalSubtitle").textContent = `${account.name} · ${dateLabel(snapshot.snapshot_date)}`;
  showModal("snapshotModal");
}
async function openSettings() {
  showModal("settingsModal");
  try {
    const settings = await api("/settings");
    $("#settingsAccounts").textContent = settings.accounts;
    $("#settingsSnapshots").textContent = settings.snapshots;
    $("#settingsVersion").textContent = settings.version;
    $("#settingsForm").elements.date_format.value = settings.dateFormat;
  } catch {
    $("#settingsVersion").textContent = window.WORTHLY_VERSION || "—";
  }
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) setView(viewButton.dataset.view);
  const updateButton = event.target.closest("[data-update]");
  if (updateButton) openUpdateModal(Number(updateButton.dataset.update));
  const historyButton = event.target.closest("[data-history]");
  if (historyButton) openHistory(Number(historyButton.dataset.history));
  const historyRange = event.target.closest("[data-history-range]");
  if (historyRange) applyHistoryRange(historyRange.dataset.historyRange);
  const historyPage = event.target.closest("[data-history-page]");
  if (historyPage && !historyPage.disabled) {
    state.history.page += historyPage.dataset.historyPage === "next" ? 1 : -1;
    loadAccountHistory();
  }
  const editAccountButton = event.target.closest("[data-edit-account]");
  if (editAccountButton) openEditAccount(Number(editAccountButton.dataset.editAccount));
  const editSnapshotButton = event.target.closest("[data-edit-snapshot]");
  if (editSnapshotButton) openSnapshotModal(Number(editSnapshotButton.dataset.editSnapshot));
  const rangeButton = event.target.closest("[data-range]");
  if (rangeButton) {
    state.chartRange = rangeButton.dataset.range;
    renderDashboard();
  }
  const reportModeButton = event.target.closest("[data-report-mode]");
  if (reportModeButton) {
    state.reportMode = reportModeButton.dataset.reportMode;
    $("#pageTitle").textContent = state.reportMode === "annual" ? "Raport roczny" : "Raport miesięczny";
    renderReport();
  }
  const activityPreset = event.target.closest("[data-activity-preset]");
  if (activityPreset) {
    applyActivityPreset(activityPreset.dataset.activityPreset);
    renderActivity();
  }
  if (event.target.closest("#resetActivityFilters")) {
    state.activity.filters = { from: "", to: "", accountId: "", source: "", preset: "all" };
    renderActivity();
  }
  if (event.target.closest("#loadMoreActivity")) {
    state.activity.page += 1;
    loadActivity();
  }
  const goalComplete = event.target.closest("[data-goal-complete]");
  if (goalComplete) {
    const goal = state.dashboard.goals.find((item) => item.id === Number(goalComplete.dataset.goalComplete));
    api(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify({ completed: !goal.completed }) })
      .then(loadDashboard).then(() => showToast(goal.completed ? "Cel został przywrócony." : "Gratulacje — cel oznaczono jako osiągnięty."));
  }
  const goalDelete = event.target.closest("[data-goal-delete]");
  if (goalDelete && window.confirm("Usunąć ten cel finansowy?")) {
    api(`/goals/${goalDelete.dataset.goalDelete}`, { method: "DELETE" })
      .then(loadDashboard).then(() => showToast("Cel został usunięty."));
  }
  if (event.target.closest("#addAccountTop, #addAccountView")) openAccountModal();
  if (event.target.closest("#addGoal")) {
    $("#goalForm").reset();
    const startDate = $("#goalForm [name=start_date]");
    const timeline = state.dashboard.timeline;
    startDate.min = timeline[0]?.date || "";
    startDate.max = isoDateOffset();
    startDate.value = isoDateOffset();
    showModal("goalModal");
  }
  if (event.target.closest("#quickUpdate, #updateTop")) openUpdateModal();
  if (event.target.closest("#settingsButton")) openSettings();
  if (event.target.closest("#toggleArchived")) {
    state.showArchived = !state.showArchived;
    renderAccounts();
  }
  if (event.target.closest("#printReport")) window.print();
  if (event.target.closest("#previousReportMonth")) moveReportMonth(-1);
  if (event.target.closest("#nextReportMonth")) moveReportMonth(1);
  if (event.target.closest("#previousReportYear")) {
    state.selectedYear -= 1;
    renderAnnualReport();
  }
  if (event.target.closest("#nextReportYear")) {
    state.selectedYear += 1;
    renderAnnualReport();
  }
  if (event.target.closest(".close-modal")) closeModals();
});

$$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("mousedown", (event) => {
  if (event.target === backdrop) closeModals();
}));
$$(".kind-toggle button").forEach((button) => button.addEventListener("click", () => setAccountKind(button.dataset.kind)));
$("#updateAccount").addEventListener("change", syncUpdateAccount);
$("#retryButton").addEventListener("click", loadDashboard);
$("#openMenu").addEventListener("click", () => $("#sidebar").classList.add("open"));
$("#closeMenu").addEventListener("click", () => $("#sidebar").classList.remove("open"));
$("#notificationButton").addEventListener("click", () => {
  $("#notificationPanel").hidden = !$("#notificationPanel").hidden;
});
$("#importFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  $("#importFileName").textContent = file ? file.name : "Wybierz plik JSON lub CSV";
  $("#importButton").disabled = !file;
  const csvFile = file?.name.toLowerCase().endsWith(".csv");
  $("#importMode").disabled = Boolean(csvFile);
  if (csvFile) $("#importMode").value = "merge";
  $("#importWarning").hidden = $("#importMode").value !== "replace";
});
$("#importMode").addEventListener("change", (event) => {
  $("#importWarning").hidden = event.target.value !== "replace";
});
$("#importButton").addEventListener("click", async () => {
  const file = $("#importFile").files[0];
  if (!file) return;
  if (file.size > 10_000_000) {
    showToast("Plik jest większy niż 10 MB.");
    return;
  }
  const csvFile = file.name.toLowerCase().endsWith(".csv");
  const mode = $("#importMode").value;
  if (!csvFile && mode === "replace" && !window.confirm("Ta operacja zastąpi wszystkie obecne konta i snapshoty zawartością kopii. Kontynuować?")) return;
  const button = $("#importButton");
  button.disabled = true;
  button.textContent = "Importowanie…";
  try {
    const text = await file.text();
    let result;
    if (csvFile) {
      result = await api("/import/csv", { method: "POST", body: JSON.stringify({ content: text }) });
    } else {
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error("Plik nie zawiera prawidłowego JSON."); }
      result = await api(`/import/json?mode=${mode}`, { method: "POST", body: JSON.stringify(payload) });
    }
    closeModals();
    await loadDashboard();
    showToast(`Import zakończony: ${result.accountsCreated} kont, ${result.snapshotsCreated} snapshotów.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Importuj dane";
  }
});
main.addEventListener("change", (event) => {
  if (event.target.id === "reportMonth") {
    state.selectedMonth = event.target.value;
    renderReport();
  }
});
main.addEventListener("submit", (event) => {
  if (event.target.id !== "activityFilters") return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.activity.filters = {
    from: String(form.get("from") || ""),
    to: String(form.get("to") || ""),
    accountId: String(form.get("accountId") || ""),
    source: String(form.get("source") || ""),
    preset: "custom",
  };
  loadActivity(true);
});
$("#historyContent").addEventListener("submit", (event) => {
  if (event.target.id !== "historyFilters") return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.history.from = String(form.get("from") || "");
  state.history.to = String(form.get("to") || "");
  state.history.range = "custom";
  state.history.page = 1;
  loadAccountHistory();
});
$("#accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button[type=submit], button:not([type])");
  button.disabled = true;
  try {
    await api("/accounts", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        institution: form.get("institution"),
        kind: form.get("kind"),
        category: form.get("category"),
        update_frequency: form.get("update_frequency"),
        opening_balance: Number(form.get("opening_balance")),
        color: form.get("kind") === "asset" ? "#2f6f5e" : "#a95342",
      }),
    });
    closeModals(); await loadDashboard(); showToast("Konto zostało dodane.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
$("#updateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button[type=submit], button:not([type])");
  button.disabled = true;
  try {
    await api(`/accounts/${form.get("account_id")}/snapshots`, {
      method: "POST",
      body: JSON.stringify({
        amount: Number(form.get("amount")),
        snapshot_date: form.get("snapshot_date"),
        note: form.get("note"),
        important: form.get("important") === "on",
      }),
    });
    closeModals(); await loadDashboard(); showToast("Saldo zostało zaktualizowane.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
$("#editAccountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button:not([type])");
  button.disabled = true;
  try {
    await api(`/accounts/${form.get("account_id")}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.get("name"),
        institution: form.get("institution"),
        category: form.get("category"),
        update_frequency: form.get("update_frequency"),
      }),
    });
    closeModals(); await loadDashboard(); showToast("Dane konta zostały zapisane.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
$("#deleteAccountButton").addEventListener("click", async () => {
  const account = state.selectedAccount;
  if (!account) return;
  if (!window.confirm(`Usunąć konto „${account.name}” wraz z całą historią snapshotów? Tej operacji nie można cofnąć.`)) return;
  const button = $("#deleteAccountButton");
  button.disabled = true;
  try {
    await api(`/accounts/${account.id}`, { method: "DELETE" });
    closeModals();
    await loadDashboard();
    if (state.view === "accounts") renderAccounts();
    showToast("Konto i jego historia zostały usunięte.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
$("#archiveAccountButton").addEventListener("click", async () => {
  const account = state.selectedAccount;
  if (!account) return;
  if (!account.archived && !window.confirm(`Zarchiwizować konto „${account.name}”? Historia zostanie zachowana.`)) return;
  const button = $("#archiveAccountButton");
  button.disabled = true;
  try {
    await api(`/accounts/${account.id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: !account.archived }),
    });
    closeModals(); await loadDashboard();
    showToast(account.archived ? "Konto zostało przywrócone." : "Konto zostało zarchiwizowane.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
$("#snapshotForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const accountId = Number(form.get("account_id"));
  const button = event.currentTarget.querySelector("button:not([type])");
  button.disabled = true;
  try {
    await api(`/snapshots/${form.get("snapshot_id")}`, {
      method: "PATCH",
      body: JSON.stringify({
        amount: Number(form.get("amount")),
        snapshot_date: form.get("snapshot_date"),
        note: form.get("note"),
        important: form.get("important") === "on",
      }),
    });
    closeModals(); await loadDashboard(); await openHistory(accountId);
    showToast("Snapshot został poprawiony.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/settings", {
      method: "PATCH",
      body: JSON.stringify({
        date_format: form.get("date_format"),
      }),
    });
    closeModals();
    await loadDashboard();
    showToast("Preferencje zostały zapisane.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#goalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button:not([type])");
  button.disabled = true;
  try {
    await api("/goals", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        target_amount: Number(form.get("target_amount")),
        start_date: form.get("start_date"),
        target_date: form.get("target_date") || null,
      }),
    });
    closeModals();
    await loadDashboard();
    setView("goals");
    showToast("Cel finansowy został dodany.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#deleteSnapshotButton").addEventListener("click", async () => {
  const form = $("#snapshotForm");
  const snapshotId = Number(form.elements.snapshot_id.value);
  const accountId = Number(form.elements.account_id.value);
  if (!window.confirm("Usunąć ten snapshot? Wykresy i raporty zostaną przeliczone. Tej operacji nie można cofnąć.")) return;
  const button = $("#deleteSnapshotButton");
  button.disabled = true;
  try {
    await api(`/snapshots/${snapshotId}`, { method: "DELETE" });
    closeModals(); await loadDashboard(); await openHistory(accountId);
    showToast("Snapshot został usunięty.");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
});
window.addEventListener("resize", () => {
  clearTimeout(window.__worthlyResize);
  window.__worthlyResize = setTimeout(renderView, 150);
});

setAccountKind("asset");
loadDashboard();
