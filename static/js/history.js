(function() {

window.renderHistory = function renderHistory() {
  var tbody = document.getElementById('history-tbody');
  if (!window.S.snapshots.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">Brak snapshotow. <a href="#" onclick="openSnapshotModal();return false" style="color:var(--green)">Dodaj pierwszy</a>.</td></tr>';
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
    var w = 64, h = 20, pad = 2;
    var xStep = (w - pad * 2) / (pts.length - 1);
    var points = pts.map(function(p, i) {
      var x = pad + i * xStep;
      var y = pad + h - pad * 2 - ((p.net_worth - nwMin) / nwRange) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastVal = pts[pts.length - 1].net_worth;
    var color = lastVal >= 0 ? '#10b981' : '#f85149';
    return '<svg width="' + w + '" height="' + h + '" class="sparkline-svg">' +
      '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  tbody.innerHTML = window.S.snapshots.map(function(s) {
    var p = prev[s.id];
    var diff = p !== undefined ? s.net_worth - p : null;
    var changeStr = diff !== null
      ? '<span class="' + (diff >= 0 ? 'text-pos' : 'text-neg') + '">' + (diff >= 0 ? '\u25B2' : '\u25BC') + ' ' + window.fmtCurrency(Math.abs(diff)) + '</span>'
      : '';
    var entriesHtml = s.entries.map(function(e) {
      return '<div class="entry-chip">' +
        '<span class="chip-name">' + window.esc(e.account_name) + '</span>' +
        '<span class="chip-val ' + (e.account_type === 'liability' ? 'text-neg' : '') + '">' + window.fmtCurrency(e.value) + '</span>' +
        '</div>';
    }).join('');

    return '<tr><td>' +
      '<button class="btn btn-icon" onclick="toggleExpand(' + s.id + ')" id="expand-btn-' + s.id + '" title="Rozwin">' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>' +
      '</button></td>' +
      '<td>' + buildSparkline(s.date) + '</td>' +
      '<td class="td-date">' + window.fmtDate(s.date) + '</td>' +
      '<td class="td-mono">' + window.fmtCurrency(s.net_worth) + ' ' + changeStr + '</td>' +
      '<td class="td-mono text-pos">' + window.fmtCurrency(s.total_assets) + '</td>' +
      '<td class="td-mono text-neg">' + window.fmtCurrency(s.total_liabilities) + '</td>' +
      '<td><div class="td-actions">' +
      '<button class="btn btn-icon" onclick="openSnapshotModal(' + s.id + ')" title="Edytuj">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/></svg>' +
      '</button>' +
      '<button class="btn btn-icon" onclick="deleteSnapshot(' + s.id + ')" title="Usun" style="color:var(--red)">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>' +
      '</button></div></td></tr>' +
      '<tr class="expandable-row" id="expand-row-' + s.id + '">' +
      '<td colspan="7"><div class="entries-grid">' + (entriesHtml || '<span class="text-muted">Brak wpisow</span>') + '</div></td></tr>';
  }).join('');
};

window.toggleExpand = function toggleExpand(id) {
  var row = document.getElementById('expand-row-' + id);
  var btn = document.getElementById('expand-btn-' + id);
  row.classList.toggle('open');
  btn.querySelector('svg').style.transform = row.classList.contains('open') ? 'rotate(90deg)' : '';
};

// Snapshot modal
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
          '<input type="number" class="form-input" step="0.01" min="0" data-account-id="' + a.id + '" data-account-type="' + a.type + '" value="' + val + '" placeholder="puste = pomin">' +
          '</div>';
      }).join('');
  }

  var formHtml = buildSection(assets, 'Aktywa') + buildSection(liabs, 'Zobowiazania');

  if (!allAccounts.length) {
    formHtml = '<p class="text-muted text-sm" style="padding:12px 0">Najpierw dodaj konta na zakladce <b>Konta</b>.</p>';
  } else if (isPrefilled) {
    formHtml += '<p class="text-muted text-sm" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)">Wartosci przepisane z poprzedniego snapshotu (' + window.fmtDate(window.S.snapshots[0].date) + '). Zmien to co sie zmienilo.</p>';
  }

  document.getElementById('snapshot-entries-form').innerHTML = formHtml;
  window.openModal('modal-snapshot-overlay');
};

window.saveSnapshot = async function saveSnapshot() {
  var date = document.getElementById('snapshot-date').value;
  if (!date) { alert('Wybierz date.'); return; }

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
    alert('Blad: ' + e.message);
  }
};

window.deleteSnapshot = async function deleteSnapshot(id) {
  if (!confirm('Usunac ten snapshot?')) return;
  try {
    await window.DELETE('/api/snapshots/' + id);
    await window.refresh();
    window.renderHistory();
    window.renderDashboard();
  } catch(e) { alert('Blad: ' + e.message); }
};

})();
