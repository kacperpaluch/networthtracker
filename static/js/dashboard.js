(function() {

window.renderDashboard = function renderDashboard() {
  var s = window.S.summary;
  var hasAccounts = window.S.accounts.filter(function(a) { return !a.archived; }).length > 0;
  var hasData = s && s.has_data;

  // Empty state
  document.getElementById('empty-state').style.display = hasData ? 'none' : 'flex';
  document.getElementById('dashboard-content').style.display = hasData ? 'block' : 'none';
  if (!hasData) {
    document.getElementById('empty-snapshot-btn').style.display = hasAccounts ? 'inline-flex' : 'none';
    return;
  }

  // Summary cards
  var cardNwEl = document.getElementById('card-nw');
  cardNwEl.textContent = window.fmtCurrency(s.current_net_worth);
  cardNwEl.className = 'card-value mono ' + (s.current_net_worth >= 0 ? 'text-pos' : 'text-neg');
  var nwChange = document.getElementById('card-nw-change');
  if (s.prev_change !== undefined) {
    nwChange.innerHTML = window.changeHtml(s.prev_change, s.prev_change_pct) + '<span class="text-muted text-sm"> vs ' + window.fmtDate(s.prev_date) + '</span>';
  } else {
    nwChange.innerHTML = '<span class="text-muted">Pierwszy snapshot</span>';
  }

  document.getElementById('card-assets').textContent = window.fmtCurrency(s.current_assets);
  document.getElementById('card-assets-sub').textContent = 'na dzien ' + window.fmtDate(s.current_date);

  document.getElementById('card-liabs').textContent = window.fmtCurrency(s.current_liabilities);
  var liabRatio = document.getElementById('card-liabs-ratio');
  if (s.debt_to_assets !== undefined) {
    var pct = (s.debt_to_assets * 100).toFixed(1);
    liabRatio.innerHTML = '<span class="text-muted">Wskaznik D/A: ' + pct + '%</span>';
  }

  var ytdEl = document.getElementById('card-ytd');
  var ytdSub = document.getElementById('card-ytd-sub');
  if (s.ytd_change !== undefined) {
    ytdEl.innerHTML = window.changeHtml(s.ytd_change, s.ytd_change_pct, false);
    ytdSub.innerHTML = '<span class="text-muted">od ' + window.fmtDate(s.ytd_start_date) + '</span>';
  } else {
    ytdEl.textContent = '\u2014';
    ytdSub.innerHTML = '<span class="text-muted">Brak danych YTD</span>';
  }

  // Charts
  window.renderNetworthChart();
  window.renderBreakdownChart();
  window.renderCompareSelects();
  window.renderTrendPills();
  window.renderAssetStructure();
};

// Compare
window.renderCompareSelects = function renderCompareSelects() {
  var dates = [].concat(window.S.series).map(function(s) { return s.date; }).reverse();
  ['compare-from','compare-to'].forEach(function(id, idx) {
    var sel = document.getElementById(id);
    sel.innerHTML = dates.map(function(d) {
      return '<option value="' + d + '">' + window.fmtDate(d) + '</option>';
    }).join('');
    if (idx === 0 && dates.length > 1) sel.value = dates[dates.length - 1];
    if (idx === 1) sel.value = dates[0];
  });
};

window.comparePreset = function comparePreset(days) {
  var to = new Date();
  var from = new Date(to - days * 86400000);
  var toStr   = to.toISOString().slice(0,10);
  var fromStr = from.toISOString().slice(0,10);
  document.getElementById('compare-to').value = toStr;
  document.getElementById('compare-from').value = fromStr;
  window.runCompare();
};

window.runCompare = async function runCompare() {
  var from = document.getElementById('compare-from').value;
  var to   = document.getElementById('compare-to').value;
  if (!from || !to) return;
  var res = await window.GET('/api/stats/compare?from=' + from + '&to=' + to);
  var el = document.getElementById('compare-result');
  if (!res.has_data) {
    el.innerHTML = '<p class="text-muted text-sm" style="margin-top:8px">Brak wystarczajacych danych dla wybranego okresu.</p>';
    return;
  }
  var pos = res.change >= 0;
  var cls = pos ? 'text-pos' : 'text-neg';
  var html = '<div class="compare-numbers" style="margin-top:12px">' +
    '<div><div class="text-muted text-sm">' + window.fmtDate(res.from_date) + '</div>' +
    '<div class="compare-big">' + window.fmtCurrency(res.from_net_worth) + '</div></div>' +
    '<span class="compare-arrow">\u2192</span>' +
    '<div><div class="text-muted text-sm">' + window.fmtDate(res.to_date) + '</div>' +
    '<div class="compare-big">' + window.fmtCurrency(res.to_net_worth) + '</div></div>' +
    '<div class="' + cls + '" style="margin-left:8px">' +
    '<div class="compare-delta">' + (pos ? '\u25B2' : '\u25BC') + ' ' + window.fmtCurrency(Math.abs(res.change)) + '</div>' +
    (res.change_pct !== null ? '<div class="text-sm">' + Math.abs(res.change_pct).toFixed(1) + '%</div>' : '') +
    '</div></div>';

  if (res.best_account || res.worst_account) {
    html += '<div class="compare-accounts" style="margin-top:12px">';
    if (res.best_account) {
      html += '<div class="compare-acc-card"><div class="compare-acc-label">Najlepszy</div>' +
        '<div class="compare-acc-name">' + window.esc(res.best_account.name) + '</div>' +
        '<div class="compare-acc-val text-pos">' + window.changeHtml(res.best_account.net_impact, null, true) + '</div></div>';
    }
    if (res.worst_account && res.worst_account.name !== (res.best_account && res.best_account.name)) {
      html += '<div class="compare-acc-card"><div class="compare-acc-label">Najgorszy</div>' +
        '<div class="compare-acc-name">' + window.esc(res.worst_account.name) + '</div>' +
        '<div class="compare-acc-val text-neg">' + window.changeHtml(res.worst_account.net_impact, null, true) + '</div></div>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
};

// Trend pills
window.renderTrendPills = function renderTrendPills() {
  var s = window.S.summary;
  var pills = [];
  if (s.avg_monthly_change !== undefined) {
    var pos = s.avg_monthly_change >= 0;
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Sr. miesieczna zmiana</div>' +
      '<div class="stat-pill-value ' + (pos ? 'text-pos' : 'text-neg') + '">' +
      (pos ? '\u25B2' : '\u25BC') + ' ' + window.fmtCurrency(Math.abs(s.avg_monthly_change)) +
      '</div></div>');
  }
  if (s.cagr !== undefined) {
    var cagrPos = s.cagr >= 0;
    pills.push('<div class="stat-pill"><div class="stat-pill-label">CAGR (roczny wzrost)</div>' +
      '<div class="stat-pill-value ' + (cagrPos ? 'text-pos' : 'text-neg') + '">' +
      (cagrPos ? '\u25B2' : '\u25BC') + ' ' + Math.abs(s.cagr).toFixed(1) + '%' +
      '</div></div>');
  }
  if (!pills.length) {
    pills.push('<p class="text-muted text-sm">Trendy beda dostepne po zapisaniu kilku snapshotow z co najmniej rocznym odstepem.</p>');
  }
  document.getElementById('trend-pills').innerHTML = pills.join('');
};

// Asset structure
window.renderAssetStructure = function renderAssetStructure() {
  var s = window.S.summary;
  if (!s || !s.asset_structure) return;
  var el = document.getElementById('asset-structure');
  var assets = s.asset_structure.filter(function(a) { return a.type === 'asset'; });
  var liabs  = s.asset_structure.filter(function(a) { return a.type === 'liability'; });
  var html = '';

  if (assets.length) {
    html += '<div class="accounts-group-title" style="margin-bottom:8px">Aktywa</div>';
    assets.forEach(function(a) {
      var pct = a.pct || 0;
      html += '<div class="structure-row">' +
        '<div class="structure-name" title="' + window.esc(a.name) + '">' + window.esc(a.name) + '</div>' +
        '<div class="structure-bar-wrap"><div class="structure-bar" style="width:' + Math.min(pct,100) + '%"></div></div>' +
        '<div class="structure-pct">' + pct.toFixed(0) + '%</div>' +
        '<div class="structure-val">' + window.fmtCurrency(a.value) + '</div></div>';
    });
  }
  if (liabs.length) {
    html += '<div class="accounts-group-title" style="margin-top:14px;margin-bottom:8px">Zobowiazania</div>';
    liabs.forEach(function(a) {
      html += '<div class="structure-row">' +
        '<div class="structure-name" title="' + window.esc(a.name) + '">' + window.esc(a.name) + '</div>' +
        '<div class="structure-bar-wrap"><div class="structure-bar liability" style="width:' + Math.min((a.value/(s.current_assets||1))*100,100) + '%"></div></div>' +
        '<div class="structure-pct"></div>' +
        '<div class="structure-val">' + window.fmtCurrency(a.value) + '</div></div>';
    });
  }

  if (s.debt_to_assets !== undefined) {
    var ap = Math.max(0, Math.min(100, 100 / (1 + s.debt_to_assets)));
    var lp = 100 - ap;
    html += '<div style="margin-top:14px">' +
      '<div class="text-muted text-sm" style="margin-bottom:6px">Struktura aktyw/zobowiazania</div>' +
      '<div class="ratio-bar"><div class="ratio-bar-asset" style="width:' + ap.toFixed(1) + '%"></div><div class="ratio-bar-liab" style="width:' + lp.toFixed(1) + '%"></div></div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
      '<span class="text-sm text-pos">Aktywa ' + ap.toFixed(0) + '%</span>' +
      '<span class="text-sm text-neg">Zobowiazania ' + lp.toFixed(0) + '%</span></div></div>';
  }

  el.innerHTML = html;
};

})();
