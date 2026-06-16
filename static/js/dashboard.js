(function() {

window.renderDashboard = function renderDashboard() {
  var s = window.S.summary;
  var hasAccounts = window.S.accounts.filter(function(a) { return !a.archived; }).length > 0;
  var hasData = s && s.has_data;

  document.getElementById('empty-state').style.display = hasData ? 'none' : 'flex';
  document.getElementById('dashboard-content').style.display = hasData ? 'block' : 'none';
  if (!hasData) {
    document.getElementById('empty-snapshot-btn').style.display = hasAccounts ? 'inline-flex' : 'none';
    window.refreshIcons();
    return;
  }

  var cardNwEl = document.getElementById('card-nw');
  cardNwEl.textContent = window.fmtCurrency(s.current_net_worth);
  cardNwEl.className = 'card-value mono ' + (s.current_net_worth >= 0 ? 'text-pos' : 'text-neg');
  var nwChange = document.getElementById('card-nw-change');
  if (s.prev_change !== undefined) {
    nwChange.innerHTML = window.changePillHtml(s.prev_change, s.prev_change_pct) + '<span class="text-muted text-sm">vs ' + window.fmtDate(s.prev_date) + '</span>';
  } else {
    nwChange.innerHTML = '<span class="text-muted">Pierwszy snapshot</span>';
  }

  document.getElementById('card-assets').textContent = window.fmtCurrency(s.current_assets);
  document.getElementById('card-assets-sub').textContent = 'na dzień ' + window.fmtDate(s.current_date);

  document.getElementById('card-liabs').textContent = window.fmtCurrency(s.current_liabilities);
  var liabRatio = document.getElementById('card-liabs-ratio');
  if (s.debt_to_assets !== undefined) {
    var pct = (s.debt_to_assets * 100).toFixed(1);
    liabRatio.innerHTML = '<span class="text-muted">Wskaźnik D/A: <strong>' + pct + '%</strong></span>';
  }

  var ytdEl = document.getElementById('card-ytd');
  var ytdSub = document.getElementById('card-ytd-sub');
  if (s.ytd_change !== undefined) {
    ytdEl.innerHTML = window.changePillHtml(s.ytd_change, s.ytd_change_pct, false);
    ytdSub.innerHTML = '<span class="text-muted">od ' + window.fmtDate(s.ytd_start_date) + '</span>';
  } else {
    ytdEl.textContent = '\u2014';
    ytdSub.innerHTML = '<span class="text-muted">Brak danych YTD</span>';
  }

  window.renderNetworthChart();
  window.renderBreakdownChart();
  window.renderAllocationDonut();
  window.renderMonthlyChart();
  window.renderCompareSelects();
  window.renderTrendPills();
  window.renderAssetStructure();
  window.renderMilestone();
  window.refreshIcons();
};

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
  document.querySelectorAll('.compare-presets .btn-ghost').forEach(function(b){b.classList.remove('active');});
  var labels = { 30: 0, 90: 1, 365: 2 };
  var btns = document.querySelectorAll('.compare-presets .btn-ghost');
  if (btns[labels[days]]) btns[labels[days]].classList.add('active');
  window.runCompare();
};

window.runCompare = async function runCompare() {
  var from = document.getElementById('compare-from').value;
  var to   = document.getElementById('compare-to').value;
  if (!from || !to) return;
  var res = await window.GET('/api/stats/compare?from=' + from + '&to=' + to);
  var el = document.getElementById('compare-result');
  if (!res.has_data) {
    el.innerHTML = '<p class="text-muted text-sm" style="margin-top:8px">Brak wystarczających danych dla wybranego okresu.</p>';
    return;
  }
  var pos = res.change >= 0;
  var cls = pos ? 'text-pos' : 'text-neg';
  var html = '<div class="compare-numbers" style="margin-top:12px">' +
    '<div><div class="text-muted text-sm">' + window.fmtDate(res.from_date) + '</div>' +
    '<div class="compare-big">' + window.fmtCurrency(res.from_net_worth) + '</div></div>' +
    '<span class="compare-arrow">&rarr;</span>' +
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
        '<div class="compare-acc-val text-pos">' + window.changePillHtml(res.best_account.net_impact, null, true) + '</div></div>';
    }
    if (res.worst_account && res.worst_account.name !== (res.best_account && res.best_account.name)) {
      html += '<div class="compare-acc-card"><div class="compare-acc-label">Najgorszy</div>' +
        '<div class="compare-acc-name">' + window.esc(res.worst_account.name) + '</div>' +
        '<div class="compare-acc-val text-neg">' + window.changePillHtml(res.worst_account.net_impact, null, true) + '</div></div>';
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
      '<div class="stat-pill-value mono">' + s.snapshot_count + '</div></div>');
  }
  if (s.days_tracked !== undefined) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Dni śledzenia</div>' +
      '<div class="stat-pill-value mono">' + s.days_tracked + '</div></div>');
  }
  if (s.avg_monthly_change !== undefined) {
    var pos = s.avg_monthly_change >= 0;
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Śr. miesięczna zmiana</div>' +
      '<div class="stat-pill-value mono ' + (pos ? 'text-pos' : 'text-neg') + '">' +
      (pos ? '\u25B2' : '\u25BC') + ' ' + window.fmtCurrency(Math.abs(s.avg_monthly_change)) +
      '</div></div>');
  }
  if (s.cagr !== undefined) {
    var cagrPos = s.cagr >= 0;
    pills.push('<div class="stat-pill"><div class="stat-pill-label">CAGR</div>' +
      '<div class="stat-pill-value mono ' + (cagrPos ? 'text-pos' : 'text-neg') + '">' +
      (cagrPos ? '\u25B2' : '\u25BC') + ' ' + Math.abs(s.cagr).toFixed(1) + '%' +
      '</div></div>');
  }
  if (s.volatility !== undefined) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Zmienność</div>' +
      '<div class="stat-pill-value mono">' + window.fmtCurrency(s.volatility) + '</div></div>');
  }
  if (s.best_month) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Najlepszy miesiąc</div>' +
      '<div class="stat-pill-value mono text-pos">\u25B2 ' + window.fmtCurrency(s.best_month.change) +
      '</div><div class="text-sm text-muted" style="margin-top:4px">' + s.best_month.month + '</div></div>');
  }
  if (s.worst_month) {
    pills.push('<div class="stat-pill"><div class="stat-pill-label">Najgorszy miesiąc</div>' +
      '<div class="stat-pill-value mono text-neg">\u25BC ' + window.fmtCurrency(Math.abs(s.worst_month.change)) +
      '</div><div class="text-sm text-muted" style="margin-top:4px">' + s.worst_month.month + '</div></div>');
  }

  var growth = s.account_growth_rates;
  if (growth && growth.length) {
    var top = growth.slice(0, 3);
    top.forEach(function(a) {
      var p = a.avg_monthly_change >= 0;
      pills.push('<div class="stat-pill"><div class="stat-pill-label">' + window.esc(a.name) + ' / mies.</div>' +
        '<div class="stat-pill-value mono ' + (p ? 'text-pos' : 'text-neg') + '">' +
        (p ? '\u25B2' : '\u25BC') + ' ' + window.fmtCurrency(Math.abs(a.avg_monthly_change)) +
        '</div></div>');
    });
  }

  if (!pills.length) {
    pills.push('<p class="text-muted text-sm">Trendy będą dostępne po zapisaniu kilku snapshotów z co najmniej rocznym odstępem.</p>');
  }
  document.getElementById('trend-pills').innerHTML = pills.join('');
};

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
    html += '<div class="accounts-group-title" style="margin-top:14px;margin-bottom:8px">Zobowiązania</div>';
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
      '<div class="text-muted text-sm" style="margin-bottom:6px">Struktura aktywa / zobowiązania</div>' +
      '<div class="ratio-bar"><div class="ratio-bar-asset" style="width:' + ap.toFixed(1) + '%"></div><div class="ratio-bar-liab" style="width:' + lp.toFixed(1) + '%"></div></div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:6px">' +
      '<span class="text-sm text-pos">Aktywa ' + ap.toFixed(0) + '%</span>' +
      '<span class="text-sm text-neg">Zobowiązania ' + lp.toFixed(0) + '%</span></div></div>';
  }

  el.innerHTML = html;
};

window.renderWaterfall = function renderWaterfall(res) {
  var el = document.getElementById('waterfall-container');
  if (!el) return;
  var changes = res.account_changes;
  if (!changes || !changes.length) { el.innerHTML = ''; return; }
  var maxAbs = 0;
  changes.forEach(function(c) { var a = Math.abs(c.net_impact); if (a > maxAbs) maxAbs = a; });
  if (maxAbs === 0) { el.innerHTML = ''; return; }

  var html = '<div class="text-sm text-muted" style="margin-bottom:8px">Wpływ poszczególnych kont na zmianę net worth</div>';
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

window.renderMilestone = function renderMilestone() {
  var s = window.S.summary;
  var el = document.getElementById('milestone-widget');
  if (!el) return;
  if (!s || !s.has_data) { el.innerHTML = ''; return; }
  var nw = s.current_net_worth;
  var milestones = window.S.milestones || [];

  if (!milestones.length && window.S.settings && window.S.settings.milestone_goal !== null && window.S.settings.milestone_goal !== undefined) {
    milestones = [{target_date: null, target_value: window.S.settings.milestone_goal, label: null, id: '_goal'}];
  }

  var html = '<div class="section-title" style="justify-content:space-between;width:100%">' +
    '<span>Cele finansowe</span>' +
    '<button class="btn btn-ghost btn-sm" onclick="openMilestoneModal()" title="Dodaj cel" style="margin-left:auto">' +
      '<i data-lucide="plus" class="icon-sm"></i>' +
    '</button></div>';

  if (!milestones.length) {
    html += '<p class="text-muted text-sm" style="padding:8px 0">Brak celów. Kliknij + aby dodać pierwszy.</p>';
    el.innerHTML = html;
    window.refreshIcons();
    return;
  }

  var firstVal = window.S.series.length ? window.S.series[0].net_worth : 0;

  milestones.forEach(function(m) {
    // Kierunek celu liczymy względem punktu startu (pierwszy snapshot),
    // a postęp to droga przebyta od startu do celu — nie od bieżącej wartości.
    var goalUp = m.target_value >= firstVal;
    var isReached = goalUp ? nw >= m.target_value : nw <= m.target_value;
    var denom = m.target_value - firstVal;
    if (Math.abs(denom) < 0.01) denom = (m.target_value - nw) || 1;
    var pct = isReached ? 100 : Math.min(100, Math.max(0, ((nw - firstVal) / denom) * 100));
    var barWidth = pct < 3 && pct > 0 ? 3 : pct;
    var remaining = Math.abs(m.target_value - nw);
    var barCls = isReached ? ' milestone-bar-done' : (goalUp ? '' : ' milestone-bar-down');

    var dateStr = m.target_date ? window.fmtDate(m.target_date) : '';
    var labelStr = m.label ? window.esc(m.label) : (dateStr || 'Cel');

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
            etaHtml = '<div class="text-sm text-muted" style="margin-top:4px">ETA: <strong>' + etaStr + '</strong></div>';
          } else {
            etaHtml = '<div class="text-sm text-muted" style="margin-top:4px">przy obecnym tempie: ponad 50 lat</div>';
          }
        } else {
          etaHtml = '<div class="text-sm text-muted" style="margin-top:4px">przy obecnym tempie cel oddala się</div>';
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
        (days < 0 ? 'minęło ' + Math.abs(days) + ' dni' : (days === 0 ? 'dziś' : 'za ' + days + ' dni')) + '</span>';
    }

    html += '<div class="milestone-row" style="' + (isReached ? 'opacity:.7' : '') + '">' +
      '<div class="milestone-top">' +
        '<span class="milestone-label">' + labelStr + '</span>' +
        '<span class="milestone-target mono">' + window.fmtCurrency(m.target_value) + '</span>' +
        (isReached ? '<span class="milestone-check"><i data-lucide="check-circle-2" class="icon-sm"></i></span>' :
          '<span class="milestone-remaining text-muted text-sm">' + window.fmtCurrency(remaining) + '</span>') +
      '</div>' +
      '<div class="milestone-meta">' +
        (m.target_date ? '<span class="text-sm text-muted">' + dateStr + '</span>' : '') +
        daysLeft +
      '</div>' +
      etaHtml +
      '<div class="milestone-bar-wrap" style="margin-top:6px">' +
        '<div class="milestone-bar' + barCls + '" style="width:' + barWidth.toFixed(1) + '%"></div>' +
      '</div>' +
      '<div class="milestone-actions">' +
        (m.id !== '_goal' ? '<button class="btn btn-icon btn-sm" onclick="openMilestoneModal(' + m.id + ')" title="Edytuj"><i data-lucide="pencil" class="icon-sm"></i></button>' +
         '<button class="btn btn-icon btn-sm" onclick="deleteMilestone(' + m.id + ')" title="Usuń" style="color:var(--neg)"><i data-lucide="trash-2" class="icon-sm"></i></button>' : '') +
      '</div>' +
      '</div>';
  });

  el.innerHTML = html;
  window.refreshIcons();
};

window.openMilestoneModal = function openMilestoneModal(id) {
  var m = id ? window.S.milestones.find(function(x) { return x.id === id; }) : null;
  var dateStr = m ? m.target_date : '';
  var valStr = m ? String(m.target_value) : '';
  var labelStr = m ? (m.label || '') : '';

  var html = '<div style="display:flex;flex-direction:column;gap:12px">' +
    '<div class="form-group"><label class="form-label">Data docelowa</label><input type="date" class="form-input" id="ml-date" value="' + dateStr + '"></div>' +
    '<div class="form-group"><label class="form-label">Kwota docelowa (PLN)</label><input type="number" class="form-input" id="ml-value" step="0.01" value="' + valStr + '" placeholder="np. 50000 lub -25000"></div>' +
    '<div class="form-group"><label class="form-label">Etykieta (opcjonalnie)</label><input type="text" class="form-input" id="ml-label" value="' + window.esc(labelStr) + '" placeholder="np. Spłata połowy kredytu"></div>' +
    '</div>';

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.onclick = function(e) { if (e.target === overlay) document.body.removeChild(overlay); };
  overlay.innerHTML = '<div class="modal" style="max-width:440px">' +
    '<div class="modal-header"><h2 class="modal-title">' + (m ? 'Edytuj cel' : 'Nowy cel') + '</h2>' +
    '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()"><i data-lucide="x" class="icon-md"></i></button></div>' +
    '<div class="modal-body">' + html + '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()">Anuluj</button>' +
    '<button class="btn btn-primary" id="ml-save-btn">Zapisz</button></div></div>';
  document.body.appendChild(overlay);
  window.refreshIcons();

  document.getElementById('ml-save-btn').onclick = async function() {
    var d = document.getElementById('ml-date').value;
    var v = parseFloat(document.getElementById('ml-value').value);
    var l = document.getElementById('ml-label').value || null;
    if (!d || isNaN(v)) { alert('Podaj datę i kwotę.'); return; }
    try {
      if (m) {
        await window.PATCH('/api/milestones/' + m.id, {target_date: d, target_value: v, label: l});
      } else {
        await window.POST('/api/milestones', {target_date: d, target_value: v, label: l});
      }
      document.body.removeChild(overlay);
      await window.refresh();
      window.renderDashboard();
    } catch(e) { alert('Błąd: ' + e.message); }
  };
};

window.deleteMilestone = async function deleteMilestone(id) {
  if (!confirm('Usunąć ten cel?')) return;
  try {
    await window.DELETE('/api/milestones/' + id);
    await window.refresh();
    window.renderDashboard();
  } catch(e) { alert('Błąd: ' + e.message); }
};

})();
