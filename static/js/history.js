(function() {

window.renderHistory = function renderHistory() {
  var tbody = document.getElementById('history-tbody');
  if (!window.S.snapshots.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text-muted)">Brak snapshotów. <a href="#" onclick="openSnapshotModal();return false" style="color:var(--accent)">Dodaj pierwszy</a>.</td></tr>';
    return;
  }
  var prev = {};
  var reversed = [].concat(window.S.snapshots).reverse();
  reversed.forEach(function(s, i) {
    if (i > 0) prev[s.id] = reversed[i-1].net_worth;
  });

  var series = window.S.series;
  var sparkNW = series.map(function(s) { return s.net_worth; });
  var nwMin = Math.min.apply(null, sparkNW);
  var nwMax = Math.max.apply(null, sparkNW);
  var nwRange = nwMax - nwMin || 1;

  function buildSparkline(uptoDate) {
    var pts = [];
    for (var i = 0; i < series.length; i++) {
      pts.push(series[i]);
      if (series[i].date === uptoDate) break;
    }
    if (pts.length < 2) return '';
    var w = 72, h = 22, pad = 2;
    var xStep = (w - pad * 2) / (pts.length - 1);
    var points = pts.map(function(p, i) {
      var x = pad + i * xStep;
      var y = pad + h - pad * 2 - ((p.net_worth - nwMin) / nwRange) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastVal = pts[pts.length - 1].net_worth;
    var color = lastVal >= 0 ? '#5EA832' : '#D14343';
    // Fill area underneath the line
    var firstPoint = points.split(' ')[0];
    var lastPoint = points.split(' ')[points.split(' ').length - 1];
    var firstX = firstPoint.split(',')[0];
    var lastX = lastPoint.split(',')[0];
    var areaPath = 'M' + firstX + ',' + (h - pad) + ' L' + points + ' L' + lastX + ',' + (h - pad) + ' Z';
    return '<svg width="' + w + '" height="' + h + '" class="sparkline-svg">' +
      '<path d="' + areaPath + '" fill="' + color + '" fill-opacity="0.10"/>' +
      '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  tbody.innerHTML = window.S.snapshots.map(function(s) {
    var p = prev[s.id];
    var diff = p !== undefined ? s.net_worth - p : null;
    var changeStr = diff !== null
      ? window.changePillHtml(diff, null, true)
      : '';
    var entriesHtml = s.entries.map(function(e) {
      return '<div class="entry-chip">' +
        '<span class="chip-name">' + window.esc(e.account_name) + '</span>' +
        '<span class="chip-val ' + (e.account_type === 'liability' ? 'text-neg' : '') + '">' + window.fmtCurrency(e.value) + '</span>' +
        '</div>';
    }).join('');

    return '<tr><td>' +
      '<button class="btn btn-icon" onclick="toggleExpand(' + s.id + ')" id="expand-btn-' + s.id + '" title="Rozwiń">' +
      '<i data-lucide="chevron-right" class="icon-sm"></i>' +
      '</button></td>' +
      '<td>' + buildSparkline(s.date) + '</td>' +
      '<td class="td-date">' + window.fmtDate(s.date) + '</td>' +
      '<td class="td-mono">' + window.fmtCurrency(s.net_worth) + ' ' + (diff !== null ? changeStr : '') + '</td>' +
      '<td class="td-mono text-pos">' + window.fmtCurrency(s.total_assets) + '</td>' +
      '<td class="td-mono text-neg">' + window.fmtCurrency(s.total_liabilities) + '</td>' +
      '<td><div class="td-actions">' +
      '<button class="btn btn-icon" onclick="openSnapshotModal(' + s.id + ')" title="Edytuj">' +
      '<i data-lucide="pencil" class="icon-sm"></i>' +
      '</button>' +
      '<button class="btn btn-icon" onclick="deleteSnapshot(' + s.id + ')" title="Usuń" style="color:var(--neg)">' +
      '<i data-lucide="trash-2" class="icon-sm"></i>' +
      '</button></div></td></tr>' +
      '<tr class="expandable-row" id="expand-row-' + s.id + '">' +
      '<td colspan="7"><div class="entries-grid">' + (entriesHtml || '<span class="text-muted">Brak wpisów</span>') + '</div></td></tr>';
  }).join('');
  window.refreshIcons();
};

window.toggleExpand = function toggleExpand(id) {
  var row = document.getElementById('expand-row-' + id);
  var btn = document.getElementById('expand-btn-' + id);
  var opening = !row.classList.contains('open');
  row.classList.toggle('open');
  var svg = btn.querySelector('svg');
  if (svg) svg.style.transform = opening ? 'rotate(90deg)' : '';
};

window.openSnapshotModal = function openSnapshotModal(snapshotId) {
  window.S.editingSnapshotId = snapshotId || null;
  var snapshot = snapshotId ? window.S.snapshots.find(function(s) { return s.id === snapshotId; }) : null;
  document.getElementById('snapshot-modal-title').textContent = snapshot ? 'Edytuj snapshot' : 'Nowy snapshot';

  var today = new Date().toISOString().slice(0,10);
  document.getElementById('snapshot-date').value = snapshot ? snapshot.date : today;

  var activeAccounts = window.S.accounts.filter(function(a) { return !a.archived; });
  var sourceEntries = snapshot
    ? snapshot.entries
    : (window.S.snapshots.length > 0 ? window.S.snapshots[0].entries : []);
  var isPrefilled = !snapshot && window.S.snapshots.length > 0;

  var sourceMap = {};
  sourceEntries.forEach(function(e) { sourceMap[e.account_id] = e; });

  var accountMap = new Map();
  activeAccounts.forEach(function(a) { accountMap.set(a.id, a); });
  if (snapshot) {
    sourceEntries.forEach(function(e) {
      if (!accountMap.has(e.account_id)) {
        accountMap.set(e.account_id, {
          id: e.account_id, name: e.account_name,
          type: e.account_type, archived: 1
        });
      }
    });
  }
  var allAccounts = Array.from(accountMap.values())
    .sort(function(a, b) { return a.type.localeCompare(b.type) || a.name.localeCompare(b.name); });

  var assets = allAccounts.filter(function(a) { return a.type === 'asset'; });
  var liabs  = allAccounts.filter(function(a) { return a.type === 'liability'; });

  function buildSection(accounts, label) {
    if (!accounts.length) return '';
    return '<div class="entry-section-label">' + label + '</div>' +
      accounts.map(function(a) {
        var e = sourceMap[a.id];
        var val = e ? e.value : '';
        var archTag = a.archived ? '<span class="entry-archived-tag">(zarchiwizowane)</span>' : '';
        return '<div class="snapshot-entry-row">' +
          '<span class="entry-name">' + window.esc(a.name) + ' ' + archTag + '</span>' +
          '<input type="number" class="form-input" step="0.01" min="0" data-account-id="' + a.id + '" data-account-type="' + a.type + '" value="' + val + '" placeholder="puste = pomiń">' +
          '</div>';
      }).join('');
  }

  var formHtml = buildSection(assets, 'Aktywa') + buildSection(liabs, 'Zobowiązania');

  if (!allAccounts.length) {
    formHtml = '<p class="text-muted text-sm" style="padding:12px 0">Najpierw dodaj konta na zakładce <strong>Konta</strong>.</p>';
  } else if (isPrefilled) {
    formHtml += '<p class="text-muted text-sm" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">Wartości przepisane z poprzedniego snapshotu (' + window.fmtDate(window.S.snapshots[0].date) + '). Zmień to co się zmieniło.</p>';
  }

  document.getElementById('snapshot-entries-form').innerHTML = formHtml;
  window.openModal('modal-snapshot-overlay');
};

window.saveSnapshot = async function saveSnapshot() {
  var date = document.getElementById('snapshot-date').value;
  if (!date) { alert('Wybierz datę.'); return; }

  var inputs = document.querySelectorAll('#snapshot-entries-form input[data-account-id]');
  var entries = [];
  inputs.forEach(function(inp) {
    var v = parseFloat(inp.value);
    if (!isNaN(v) && inp.value.trim() !== '') {
      entries.push({ account_id: parseInt(inp.dataset.accountId), value: v });
    }
  });

  try {
    if (window.S.editingSnapshotId) {
      await window.PATCH('/api/snapshots/' + window.S.editingSnapshotId, { date: date, entries: entries });
    } else {
      await window.POST('/api/snapshots', { date: date, entries: entries });
    }
    window.closeModal('modal-snapshot-overlay');
    await window.refresh();
    window.renderHistory();
    window.renderDashboard();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
};

window.deleteSnapshot = async function deleteSnapshot(id) {
  if (!confirm('Usunąć ten snapshot?')) return;
  try {
    await window.DELETE('/api/snapshots/' + id);
    await window.refresh();
    window.renderHistory();
    window.renderDashboard();
  } catch(e) { alert('Błąd: ' + e.message); }
};

})();
