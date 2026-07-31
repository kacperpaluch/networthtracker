const state = {
  dashboard: null,
  view: "dashboard",
  chartRange: 12,
  selectedMonth: null,
  selectedYear: new Date().getFullYear(),
  reportMode: "monthly",
  selectedAccount: null,
  allAccounts: null,
  showArchived: false,
  historySnapshots: [],
  baseCurrency: "PLN",
  dateFormat: "DD.MM.YYYY",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const main = $("#mainContent");

let money;
let compactMoney;
function configureFormatters(currency = "PLN") {
  state.baseCurrency = currency;
  money = new Intl.NumberFormat("pl-PL", {
    style: "currency", currency, maximumFractionDigits: 0,
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
const shortMonthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });

function dateValue(value) {
  return new Date(`${value}T12:00:00`);
}
function dateLabel(value) {
  const [year, month, day] = value.split("-");
  if (state.dateFormat === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  if (state.dateFormat === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  return `${day}.${month}.${year}`;
}
function nativeMoney(value, currency) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(value);
}
function monthLabel(value) {
  return shortMonthFormatter.format(dateValue(value));
}
function exchangeRateDescription(status) {
  if (!status?.currencies?.length) return "Nie dotyczy — wszystkie wartości są w PLN.";
  const rates = status.currencies.map((item) =>
    `${item.currency}: ${item.effectiveDate ? dateLabel(item.effectiveDate) : "brak kursu"}`
  ).join(" · ");
  return `Kurs jest pobierany z NBP przy zapisie snapshotu i pozostaje przypisany do jego daty. Ostatnie tabele w lokalnej bazie: ${rates}. Ręczne pobranie nie zmienia kursów historycznych snapshotów.`;
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
    const fx = state.dashboard.summary.exchangeRates;
    $("#lastUpdated").textContent = fx?.currencies?.length
      ? `Salda: ${dateLabel(state.dashboard.summary.updatedAt)} · tabela NBP w bazie: ${fx.effectiveDate ? dateLabel(fx.effectiveDate) : "brak danych"}`
      : `Salda: ${dateLabel(state.dashboard.summary.updatedAt)} · kursy walut: nie dotyczy`;
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
  const { summary, accounts, allocation, goals } = state.dashboard;
  const positive = summary.change >= 0;
  const total = summary.assets + summary.liabilities || 1;
  main.innerHTML = `
    <section class="hero-card">
      <div class="hero-copy">
        <span class="eyebrow">◉ Wartość netto</span>
        <h1>${money.format(summary.netWorth)}</h1>
        <div class="change ${positive ? "positive" : "negative"}">${positive ? "↗" : "↘"} ${signed(summary.change)} (${Math.abs(summary.changePercent)}%) <small>od ostatniej aktualizacji</small></div>
      </div>
      <div class="hero-divider"></div>
      <div class="hero-stat"><span>Aktywa</span><strong>${money.format(summary.assets)}</strong><small><i class="dot asset"></i>${Math.round(summary.assets / total * 100)}% całości</small></div>
      <div class="hero-stat"><span>Zobowiązania</span><strong>${money.format(summary.liabilities)}</strong><small><i class="dot debt"></i>${Math.round(summary.liabilities / total * 100)}% całości</small></div>
    </section>
    <div class="main-grid">
      <section class="panel chart-panel">
        <header class="panel-head"><div><h2>Wartość netto w czasie</h2><p>Aktywa pomniejszone o zobowiązania</p></div>
          <div class="range-control">
            <button data-range="6" class="${state.chartRange === 6 ? "active" : ""}">6M</button>
            <button data-range="12" class="${state.chartRange === 12 ? "active" : ""}">1R</button>
            <button data-range="999" class="${state.chartRange === 999 ? "active" : ""}">MAX</button>
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
    ${goals.length ? `<section class="panel goals-preview"><header class="panel-head"><div><h2>Cele finansowe</h2><p>Postęp względem wartości netto</p></div><button class="text-button" data-view="goals">Zobacz cele ›</button></header>${goals.slice(0, 2).map(goalCard).join("")}</section>` : ""}`;
  requestAnimationFrame(() => {
    const timeline = state.dashboard.timeline.slice(-state.chartRange);
    drawLineChart($("#netWorthChart"), timeline, "netWorth", "#2f6f5e");
    drawDonut($("#allocationChart"), allocation.map((item) => item.value), allocation.map((item) => item.color));
  });
}

function accountRow(account) {
  const favorable = account.kind === "asset" ? account.change >= 0 : account.change <= 0;
  return `<div class="table-row">
    <button class="account-name" data-history="${account.id}">
      <span class="account-icon" style="color:${esc(account.color)};background:${esc(account.color)}18">${accountGlyph(account.category)}</span>
      <span><strong>${esc(account.name)} ${account.stale ? `<i class="stale-badge">Nieaktualne ${account.staleDays} d.</i>` : ""}</strong><small>${esc(account.institution)}${account.currency !== state.baseCurrency ? ` · ${esc(account.currency)}` : ""}</small></span>
    </button>
    <span><i class="type-pill ${account.kind}">${account.kind === "asset" ? "Aktywo" : "Zobowiązanie"}</i></span>
    <span class="muted">${account.last_updated ? dateLabel(account.last_updated) : "—"}</span>
    <span class="${favorable ? "positive" : "negative"}">${signed(account.change)}</span>
    <strong class="balance">${money.format(account.current_balance)}</strong>
    <button class="row-action" data-update="${account.id}" aria-label="Aktualizuj ${esc(account.name)}">✎</button>
  </div>`;
}

function goalCard(goal) {
  return `<article class="goal-card ${goal.completed ? "completed" : ""}">
    <div class="goal-head"><span><strong>${esc(goal.name)}</strong><small>${goal.targetDate ? `Termin: ${dateLabel(goal.targetDate)}` : "Bez terminu"}</small></span><strong>${goal.progress}%</strong></div>
    <div class="goal-progress"><i style="width:${goal.progress}%"></i></div>
    <div class="goal-foot"><span>start: ${money.format(goal.startAmount)} · teraz: ${money.format(goal.currentAmount)}</span><span>cel: ${money.format(goal.targetAmount)}</span></div>
    <div class="goal-actions"><button data-goal-complete="${goal.id}">${goal.completed ? "Przywróć" : "Oznacz jako osiągnięty"}</button><button class="danger-link" data-goal-delete="${goal.id}">Usuń</button></div>
  </article>`;
}

function renderGoals() {
  const goals = state.dashboard.goals || [];
  main.innerHTML = `
    <div class="view-heading"><div><h1>Cele finansowe</h1><p>Konkretny kierunek dla rosnącej wartości netto.</p></div><button class="button primary" id="addGoal">＋ Nowy cel</button></div>
    <section class="goals-grid">${goals.length ? goals.map(goalCard).join("") : `<div class="empty-state"><strong>Nie masz jeszcze celu</strong><p>Dodaj docelową wartość netto i obserwuj postęp.</p></div>`}</section>`;
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
        <span class="institution">${esc(account.institution)} · ${esc(account.currency)}</span><h3>${esc(account.name)} ${account.stale ? `<i class="stale-badge">Nieaktualne</i>` : ""}</h3>
        <div class="account-card-balance"><strong>${money.format(account.current_balance)}</strong>${account.currency !== state.baseCurrency ? `<small class="native-balance">${nativeMoney(account.native_current_balance, account.currency)} w walucie konta</small>` : ""}</div>
        <footer class="account-card-foot"><span>${esc(account.category)}${account.stale ? ` · ${account.staleDays} dni po terminie` : ""}</span><div class="card-actions"><button data-history="${account.id}">◷ Historia</button><button data-edit-account="${account.id}">✎ ${account.archived ? "Przywróć" : "Edytuj"}</button>${account.archived ? "" : `<button data-update="${account.id}">Aktualizuj ›</button>`}</div></footer>
      </article>`).join("") : `<div class="empty-state"><strong>${state.showArchived ? "Archiwum jest puste" : "Brak pasujących kont"}</strong><p>${state.showArchived ? "Zarchiwizowane konta pojawią się tutaj." : "Zmień wyszukiwanie albo dodaj nowe konto."}</p></div>`}</section>`;
  const input = $("#accountSearch");
  input?.addEventListener("input", (event) => renderAccounts(event.target.value));
  if (query) {
    input.focus();
    input.setSelectionRange(query.length, query.length);
  }
}

function renderActivity() {
  const { recent, summary } = state.dashboard;
  main.innerHTML = `
    <div class="view-heading"><div><h1>Ostatnia aktywność</h1><p>Historia zapisanych snapshotów salda.</p></div></div>
    <section class="panel activity-list">${recent.map((item) => `
      <div class="activity-item ${item.important ? "important-change" : ""}"><span class="activity-icon ${item.kind}">${item.important ? "★" : "↻"}</span><span><strong>${esc(item.account)}</strong><small>${esc(item.note || `Saldo z dnia ${dateLabel(item.date)}`)} · snapshot ${dateLabel(item.date)}${item.currency !== state.baseCurrency ? ` · ${nativeMoney(item.nativeAmount, item.currency)}` : ""}</small>${item.currency !== "PLN" && item.rateDate ? `<small class="fx-detail">Kurs: 1 ${esc(item.currency)} = ${Number(item.rateToPln).toFixed(4)} PLN · tabela NBP z ${dateLabel(item.rateDate)}</small>` : ""}</span><strong>${money.format(item.amount)}</strong></div>`).join("")}</section>
    <section class="insight"><strong>✦ PODSUMOWANIE</strong><p>Wartość netto ${summary.change >= 0 ? "wzrosła" : "spadła"} o ${money.format(Math.abs(summary.change))} od ostatniej aktualizacji.</p></section>`;
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
    const timeline = state.dashboard.timeline.filter((item) => item.date.slice(0, 7) <= state.selectedMonth).slice(-6);
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
      <section class="report-hero"><div><span>Wartość netto na koniec okresu</span><h2>${money.format(report.netWorth)}</h2><small class="${report.change >= 0 ? "positive" : "negative"}">${report.change >= 0 ? "↗" : "↘"} ${signed(report.change)} w tym miesiącu</small></div><div class="report-score"><span>Zmiana m/m</span><strong>${report.changePercent >= 0 ? "+" : ""}${report.changePercent}%</strong><small>${report.changePercent >= 0 ? "Pozytywny kierunek" : "Miesiąc ze spadkiem"}</small></div></section>
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
      <section class="panel annual-table"><header class="panel-head"><div><h2>Miesiąc po miesiącu</h2><p>Zmiana miesięczna wartości netto</p></div></header>${report.months.map((item) => `<div><span>${monthFormatter.format(dateValue(item.date))}</span><strong>${money.format(item.netWorth)}</strong><span class="${item.change >= 0 ? "positive" : "negative"}">${signed(item.change)}</span></div>`).join("")}</section>`;
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
function drawLineChart(canvas, items, key, color, valueFormatter = compactMoney) {
  const setup = setupCanvas(canvas);
  if (!setup || !items.length) return;
  const { context: ctx, width, height } = setup;
  const pad = { left: 66, right: 12, top: 22, bottom: 28 };
  const values = items.map((item) => item[key]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const spread = max - min || Math.abs(max) * .1 || 1;
  min -= spread * .15; max += spread * .15;
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "#8b8c84";
  ctx.strokeStyle = "#e9e8e2";
  ctx.lineWidth = 1;
  for (let index = 0; index < 4; index++) {
    const y = pad.top + (height - pad.top - pad.bottom) * index / 3;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    const value = max - (max - min) * index / 3;
    ctx.fillText(valueFormatter.format(value), 2, y + 3);
  }
  const points = items.map((item, index) => ({
    x: pad.left + (width - pad.left - pad.right) * (items.length === 1 ? .5 : index / (items.length - 1)),
    y: pad.top + (height - pad.top - pad.bottom) * (1 - (item[key] - min) / (max - min)),
  }));
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, `${color}40`); gradient.addColorStop(1, `${color}00`);
  ctx.beginPath(); ctx.moveTo(points[0].x, height - pad.bottom);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height - pad.bottom); ctx.closePath();
  ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.stroke();
  const labelEvery = Math.max(1, Math.ceil(items.length / 6));
  items.forEach((item, index) => {
    if (index % labelEvery && index !== items.length - 1) return;
    ctx.fillStyle = "#8b8c84"; ctx.textAlign = "center";
    ctx.fillText(monthLabel(item.date || item.snapshot_date), points[index].x, height - 7);
  });
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
  try {
    const snapshots = await api(`/accounts/${account.id}/snapshots`);
    state.historySnapshots = snapshots;
    const chronological = [...snapshots].reverse();
    const change = chronological.length > 1 ? chronological.at(-1).amount - chronological[0].amount : 0;
    const percent = chronological.length > 1 && chronological[0].amount ? change / chronological[0].amount * 100 : 0;
    const accountMoney = (value) => nativeMoney(value, account.currency);
    const accountSigned = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${accountMoney(Math.abs(value))}`;
    $("#historyContent").innerHTML = `
      <div class="history-summary">
        <div><span>Aktualne saldo</span><strong>${accountMoney(account.native_current_balance)}</strong>${account.currency !== state.baseCurrency ? `<small>${money.format(account.current_balance)} po przeliczeniu</small>` : ""}</div>
        <div><span>Zmiana w całym okresie</span><strong class="${change >= 0 ? "positive" : "negative"}">${accountSigned(change)}</strong><small>${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%</small></div>
        <button class="button primary" data-update="${account.id}">↻ Aktualizuj saldo</button>
      </div>
      <div class="history-chart"><canvas id="historyChart"></canvas></div>
      <div class="history-table">
        <div class="history-row head"><span>Data</span><span>Notatka</span><span>Zmiana</span><span>Saldo</span><span></span></div>
        ${snapshots.map((snapshot, index) => {
          const older = snapshots[index + 1];
          const delta = older ? snapshot.amount - older.amount : 0;
          const favorable = account.kind === "asset" ? delta >= 0 : delta <= 0;
          return `<div class="history-row ${snapshot.important ? "important-change" : ""}"><span>${snapshot.important ? "★ " : ""}${dateLabel(snapshot.snapshot_date)}</span><span class="note">${esc(snapshot.note || (snapshot.source === "seed" ? "Dane demonstracyjne" : "Aktualizacja salda"))}${account.currency !== "PLN" ? `<small>Kurs NBP: ${snapshot.rate_to_pln.toFixed(4)} PLN · ${dateLabel(snapshot.rate_date)}</small>` : ""}</span><span class="${favorable ? "positive" : "negative"}">${older ? accountSigned(delta) : "—"}</span><strong>${accountMoney(snapshot.amount)}</strong><button class="snapshot-action" data-edit-snapshot="${snapshot.id}" aria-label="Edytuj snapshot z ${dateLabel(snapshot.snapshot_date)}">✎</button></div>`;
        }).join("")}
      </div>`;
    const accountCompact = new Intl.NumberFormat("pl-PL", { notation: "compact", style: "currency", currency: account.currency, maximumFractionDigits: 1 });
    requestAnimationFrame(() => drawLineChart($("#historyChart"), chronological, "amount", account.color, accountCompact));
  } catch (error) {
    $("#historyContent").innerHTML = `<p>${esc(error.message)}</p>`;
  }
}

function openEditAccount(accountId) {
  const account = findAccount(accountId);
  if (!account) return;
  state.selectedAccount = account;
  const form = $("#editAccountForm");
  form.elements.account_id.value = account.id;
  form.elements.name.value = account.name;
  form.elements.institution.value = account.institution;
  form.elements.currency.value = account.currency;
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
    $("#settingsForm").elements.base_currency.value = settings.baseCurrency;
    $("#settingsForm").elements.date_format.value = settings.dateFormat;
    $("#exchangeRatesDescription").textContent = exchangeRateDescription(settings.exchangeRates);
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
  const editAccountButton = event.target.closest("[data-edit-account]");
  if (editAccountButton) openEditAccount(Number(editAccountButton.dataset.editAccount));
  const editSnapshotButton = event.target.closest("[data-edit-snapshot]");
  if (editSnapshotButton) openSnapshotModal(Number(editSnapshotButton.dataset.editSnapshot));
  const rangeButton = event.target.closest("[data-range]");
  if (rangeButton) {
    state.chartRange = Number(rangeButton.dataset.range);
    renderDashboard();
  }
  const reportModeButton = event.target.closest("[data-report-mode]");
  if (reportModeButton) {
    state.reportMode = reportModeButton.dataset.reportMode;
    $("#pageTitle").textContent = state.reportMode === "annual" ? "Raport roczny" : "Raport miesięczny";
    renderReport();
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
$("#accountForm [name=currency]").addEventListener("change", (event) => {
  $("#openingCurrency").textContent = event.target.value;
});
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
        currency: form.get("currency"),
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
        currency: form.get("currency"),
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
$("#refreshExchangeRates").addEventListener("click", async () => {
  const button = $("#refreshExchangeRates");
  button.disabled = true;
  button.textContent = "Odświeżanie…";
  try {
    const status = await api("/exchange-rates/refresh", { method: "POST" });
    $("#exchangeRatesDescription").textContent = exchangeRateDescription(status);
    await loadDashboard();
    showToast(status.currencies.length ? "Kursy NBP zostały odświeżone." : "Brak walut wymagających kursu NBP.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Pobierz najnowsze";
  }
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
        base_currency: form.get("base_currency"),
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
