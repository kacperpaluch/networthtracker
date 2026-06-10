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
  window.renderAllocationDonut();
  window.renderMonthlyChart();
  window.renderCompareSelects();
  window.renderTrendPills();
  window.renderAssetStructure();
  window.renderMilestone();
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
  el.innerHTML = html + '<div id="waterfall-container" style="margin-top:14px"></div>';
  window.renderWaterfall(res);
};
window.renderTrendPills = function renderTrendPills() {
  var s = window.S.summary;
  var pills = [];

  if (s.snapshot_count !== undefined) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Snapshoty</div>' +
      '<div class="stat-pill-value">' + s.snapshot_count + '</div></div>');
  }
  if (s.days_tracked !== undefined) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Dni sledzenia</div>' +
      '<div class="stat-pill-value">' + s.days_tracked + '</div></div>');
  }
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
  if (s.volatility !== undefined) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Zmiennosc (odch. std)</div>' +
      '<div class="stat-pill-value">' + window.fmtCurrency(s.volatility) + '</div></div>');
  }
  if (s.best_month) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Najlepszy miesiac</div>' +
      '<div class="stat-pill-value text-pos">\u25B2 ' + window.fmtCurrency(s.best_month.change) +
      '</div><div class="text-sm text-muted" style="margin-top:2px">' + s.best_month.month + '</div></div>');
  }
  if (s.worst_month) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Najgorszy miesiac</div>' +
      '<div class="stat-pill-value text-neg">\u25BC ' + window.fmtCurrency(Math.abs(s.worst_month.change)) +
      '</div><div class="text-sm text-muted" style="margin-top:2px">' + s.worst_month.month + '</div></div>');
  }

  var growth = s.account_growth_rates;
  if (growth && growth.length) {
    var top = growth.slice(0, 3);
    top.forEach(function(a) {
      var p = a.avg_monthly_change >= 0;
      pills.push('<div class="stat-pill"><div class="stat-pill-label">' + window.esc(a.name) + ' / mies.</div>' +
        '<div class="stat-pill-value ' + (p ? 'text-pos' : 'text-neg') + '">' +
        (p ? '\u25B2' : '\u25BC') + ' ' + window.fmtCurrency(Math.abs(a.avg_monthly_change)) +
        '</div></div>');
    });
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

// Waterfall chart (account contributions between two snapshots)
window.renderWaterfall = function renderWaterfall(res) {
  var el = document.getElementById('waterfall-container');
  if (!el) return;
  var changes = res.account_changes;
  if (!changes || !changes.length) { el.innerHTML = ''; return; }
  var maxAbs = 0;
  changes.forEach(function(c) { var a = Math.abs(c.net_impact); if (a > maxAbs) maxAbs = a; });
  if (maxAbs === 0) { el.innerHTML = ''; return; }

  var html = '<div class="text-sm text-muted" style="margin-bottom:8px">Wplyw poszczegolnych kont na zmiane net worth</div>';
  changes.forEach(function(c) {
    var impact = c.net_impact;
    var pos = impact >= 0;
    var width = Math.max(2, (Math.abs(impact) / maxAbs) * 100);
    html += '<div class="waterfall-row">' +
      '<div class="waterfall-name" title="' + window.esc(c.name) + '">' + window.esc(c.name) + '</div>' +
      '<div class="waterfall-bar-wrap"><div class="waterfall-bar ' + (pos ? 'wfall-pos' : 'wfall-neg') + '" style="width:' + width.toFixed(1) + '%"></div></div>' +
      '<div class="waterfall-val ' + (pos ? 'text-pos' : 'text-neg') + '">' + (pos ? '+' : '') + window.fmtCurrency(impact) + '</div>' +
      '</div>';
  });
  el.innerHTML = html;
};

// Milestones timeline
window.renderMilestone = function renderMilestone() {
  var s = window.S.summary;
  var el = document.getElementById('milestone-widget');
  if (!el) return;
  if (!s || !s.has_data) { el.innerHTML = ''; return; }
  var nw = s.current_net_worth;
  var milestones = window.S.milestones || [];

  // Fallback: single goal from settings if no milestones defined
  if (!milestones.length && window.S.settings && window.S.settings.milestone_goal !== null && window.S.settings.milestone_goal !== undefined) {
    milestones = [{target_date: null, target_value: window.S.settings.milestone_goal, label: null, id: '_goal'}];
  }

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
    '<div class="section-title" style="margin-bottom:0">Cele finansowe</div>' +
    '<button class="btn btn-ghost btn-sm" onclick="openMilestoneModal()" title="Dodaj cel">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>' +
    '</button></div>';

  if (!milestones.length) {
    html += '<p class="text-muted text-sm" style="padding:8px 0">Brak celow. Kliknij + aby dodac pierwszy.</p>';
    el.innerHTML = html;
    return;
  }

  var firstVal = s.first_date ? (window.S.series.length ? window.S.series[0].net_worth : 0) : 0;

  milestones.forEach(function(m) {
    var isUp = m.target_value > nw;
    var start = isUp ? nw : m.target_value;
    var end   = isUp ? m.target_value : nw;
    var denom = end - start;
    if (Math.abs(denom) < 0.01) denom = 1;
    // Progress: how far current NW is from the "base" toward the target
    var base = isUp ? firstVal : firstVal;
    var progSpan = nw;
    var pct = Math.min(100, Math.max(0, ((progSpan - start) / denom) * 100));
    var barWidth = pct < 3 && pct > 0 ? 3 : pct;
    var remaining = Math.abs(m.target_value - nw);
    var isReached = (isUp && nw >= m.target_value) || (!isUp && nw <= m.target_value);
    var barCls = isReached ? ' milestone-bar-done' : (isUp ? '' : ' milestone-bar-down');

    var dateStr = m.target_date ? window.fmtDate(m.target_date) : '';
    var labelStr = m.label ? window.esc(m.label) : (dateStr || 'Cel');

    // ETA: kiedy cel zostanie osiagniety przy obecnym tempie
    var etaHtml = '';
    if (!isReached && s.avg_monthly_change !== undefined) {
      var gap = m.target_value - nw;
      var avg = s.avg_monthly_change;
      if (gap > 0) {
        if (avg > 0) {
          var monthsNeeded = gap / avg;
          if (monthsNeeded <= 600) {
            var etaDate = new Date();
            etaDate.setMonth(etaDate.getMonth() + Math.ceil(monthsNeeded));
            var etaStr = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(etaDate);
            etaHtml = '<div class="text-sm text-muted" style="margin-top:2px">przy obecnym tempie: <b>' + etaStr + '</b></div>';
          } else {
            etaHtml = '<div class="text-sm text-muted" style="margin-top:2px">przy obecnym tempie: ponad 50 lat</div>';
          }
        } else {
          etaHtml = '<div class="text-sm text-muted" style="margin-top:2px">przy obecnym tempie cel oddala sie</div>';
        }
      }
    }

    var daysLeft = '';
    if (m.target_date) {
      var targetD = new Date(m.target_date + 'T00:00:00');
      var today = new Date();
      today.setHours(0,0,0,0);
      var days = Math.ceil((targetD - today) / 86400000);
      daysLeft = '<span class="milestone-days ' + (days < 0 ? 'text-neg' : (days < 30 ? 'text-muted' : '')) + '">' +
        (days < 0 ? 'minelo ' + Math.abs(days) + ' dni' : (days === 0 ? 'dzis' : 'za ' + days + ' dni')) + '</span>';
    }

    html += '<div class="milestone-row" style="' + (isReached ? 'opacity:.55' : '') + '">' +
      '<div class="milestone-top">' +
        '<span class="milestone-label">' + labelStr + '</span>' +
        '<span class="milestone-target mono">' + window.fmtCurrency(m.target_value) + '</span>' +
        (isReached ? '<span class="milestone-check text-pos">\u2713</span>' : '<span class="milestone-remaining text-muted text-sm">' + window.fmtCurrency(remaining) + '</span>') +
      '</div>' +
      '<div class="milestone-meta">' +
        (m.target_date ? '<span class="text-sm text-muted">' + dateStr + '</span>' : '') +
        daysLeft +
      '</div>' +
      etaHtml +
      '<div class="milestone-bar-wrap" style="margin-top:4px">' +
        '<div class="milestone-bar' + barCls + '" style="width:' + barWidth.toFixed(1) + '%"></div>' +
      '</div>' +
      '<div class="milestone-actions">' +
        (m.id !== '_goal' ? '<button class="btn btn-icon btn-sm" onclick="openMilestoneModal(' + m.id + ')" title="Edytuj"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z"/></svg></button>' +
         '<button class="btn btn-icon btn-sm" onclick="deleteMilestone(' + m.id + ')" title="Usun" style="color:var(--red)"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg></button>' : '') +
      '</div>' +
      '</div>';
  });

  el.innerHTML = html;
};

// Milestone modal (inline create/edit via prompt for simplicity)
window.openMilestoneModal = function openMilestoneModal(id) {
  var m = id ? window.S.milestones.find(function(x) { return x.id === id; }) : null;
  var dateStr = m ? m.target_date : '';
  var valStr = m ? String(m.target_value) : '';
  var labelStr = m ? (m.label || '') : '';

  var html = '<div style="display:flex;flex-direction:column;gap:12px">' +
    '<div><label class="form-label">Data docelowa</label><input type="date" class="form-input" id="ml-date" value="' + dateStr + '"></div>' +
    '<div><label class="form-label">Kwota docelowa (PLN)</label><input type="number" class="form-input" id="ml-value" step="0.01" value="' + valStr + '" placeholder="np. 50000 lub -25000"></div>' +
    '<div><label class="form-label">Etykieta (opcjonalnie)</label><input type="text" class="form-input" id="ml-label" value="' + window.esc(labelStr) + '" placeholder="np. Splata polowy kredytu"></div>' +
    '</div>';

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.onclick = function(e) { if (e.target === overlay) document.body.removeChild(overlay); };
  overlay.innerHTML = '<div class="modal" style="max-width:420px">' +
    '<div class="modal-header"><h2 class="modal-title">' + (m ? 'Edytuj cel' : 'Nowy cel') + '</h2>' +
    '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">' +
    '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg></button></div>' +
    '<div class="modal-body">' + html + '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()">Anuluj</button>' +
    '<button class="btn btn-primary" id="ml-save-btn">Zapisz</button></div></div>';
  document.body.appendChild(overlay);

  document.getElementById('ml-save-btn').onclick = async function() {
    var d = document.getElementById('ml-date').value;
    var v = parseFloat(document.getElementById('ml-value').value);
    var l = document.getElementById('ml-label').value || null;
    if (!d || isNaN(v)) { alert('Podaj date i kwote.'); return; }
    try {
      if (m) {
        await window.PATCH('/api/milestones/' + m.id, {target_date: d, target_value: v, label: l});
      } else {
        await window.POST('/api/milestones', {target_date: d, target_value: v, label: l});
      }
      document.body.removeChild(overlay);
      await window.refresh();
      window.renderDashboard();
    } catch(e) { alert('Blad: ' + e.message); }
  };
};

window.deleteMilestone = async function deleteMilestone(id) {
  if (!confirm('Usunac ten cel?')) return;
  try {
    await window.DELETE('/api/milestones/' + id);
    await window.refresh();
    window.renderDashboard();
  } catch(e) { alert('Blad: ' + e.message); }
};

})();
