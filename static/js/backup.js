(function() {

window.showBackupMsg = function showBackupMsg(text, ok) {
  var el = document.getElementById('backup-msg');
  el.textContent = text;
  el.className = 'backup-msg ' + (ok ? 'ok' : 'err');
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 5000);
};

window.loadBackups = async function loadBackups() {
  try {
    var backups = await window.GET('/api/backup/list');
    window.renderBackups(backups);
  } catch(e) {
    document.getElementById('backup-tbody').innerHTML = '';
    document.getElementById('backup-empty').style.display = '';
    document.getElementById('backup-empty').textContent = 'Błąd ładowania listy backupów.';
  }
};

window.renderBackups = function renderBackups(backups) {
  var tbody = document.getElementById('backup-tbody');
  var empty = document.getElementById('backup-empty');
  if (!backups || !backups.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = backups.map(function(b) {
    return '<tr>' +
      '<td class="td-mono">' + window.esc(b.filename) + '</td>' +
      '<td class="td-mono">' + (b.size / 1024).toFixed(1) + ' KB</td>' +
      '<td class="td-date">' + b.created_at.replace('T', ' ').slice(0, 19) + '</td>' +
      '<td><div class="td-actions">' +
      '<button class="btn btn-icon" onclick="downloadBackup(\'' + window.esc(b.filename) + '\')" title="Pobierz">' +
      '<i data-lucide="download" class="icon-sm"></i>' +
      '</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="restoreFromServer(\'' + window.esc(b.filename) + '\')" title="Przywróć">Przywróć</button>' +
      '<button class="btn btn-icon" onclick="deleteBackup(\'' + window.esc(b.filename) + '\')" title="Usuń" style="color:var(--neg)">' +
      '<i data-lucide="trash-2" class="icon-sm"></i>' +
      '</button></div></td></tr>';
  }).join('');
  window.refreshIcons();
};

window.createBackup = async function createBackup() {
  try {
    await window.POST('/api/backup/create', {});
    window.showBackupMsg('Backup utworzony pomyślnie!', true);
    await window.loadBackups();
  } catch(e) { window.showBackupMsg('Błąd tworzenia backupu: ' + e.message, false); }
};

window.downloadBackup = function downloadBackup(filename) {
  var a = document.createElement('a');
  a.href = '/api/backup/download/' + encodeURIComponent(filename);
  a.download = filename;
  a.click();
};

window.restoreFromServer = async function restoreFromServer(filename) {
  if (!confirm('Przywrócić backup "' + filename + '"?\nBieżące dane zostaną nadpisane.')) return;
  try {
    await window.POST('/api/backup/restore/' + encodeURIComponent(filename), {});
    window.showBackupMsg('Backup przywrócony pomyślnie!', true);
    await window.refresh();
    window.renderDashboard();
  } catch(e) { window.showBackupMsg('Błąd przywracania: ' + e.message, false); }
};

window.restoreFromUpload = async function restoreFromUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!confirm('Wczytać plik "' + file.name + '" i nadpisać bieżące dane?')) {
    event.target.value = '';
    return;
  }
  try {
    var formData = new FormData();
    formData.append('file', file);
    var r = await fetch('/api/backup/restore-upload', { method: 'POST', body: formData });
    if (!r.ok) {
      var err = await r.json().catch(function() { return { detail: r.statusText }; });
      throw new Error(err.detail || r.statusText);
    }
    window.showBackupMsg('Plik przywrócony pomyślnie!', true);
    await window.refresh();
    window.renderDashboard();
  } catch(e) { window.showBackupMsg('Błąd wczytywania pliku: ' + e.message, false); }
  event.target.value = '';
};

window.deleteBackup = async function deleteBackup(filename) {
  if (!confirm('Usunąć backup "' + filename + '"?')) return;
  try {
    var r = await fetch('/api/backup/' + encodeURIComponent(filename), { method: 'DELETE' });
    if (!r.ok) {
      var err = await r.json().catch(function() { return { detail: r.statusText }; });
      throw new Error(err.detail || r.statusText);
    }
    await window.loadBackups();
  } catch(e) { window.showBackupMsg('Błąd usuwania: ' + e.message, false); }
};

window.loadCronSetting = async function loadCronSetting() {
  try {
    var s = await window.GET('/api/settings');
    document.getElementById('cron-input').value = s.backup_cron || '0 4 * * *';
    document.getElementById('webhook-input').value = s.webhook_url || '';
  } catch(e) { /* ignore */ }
};

window.saveWebhook = async function saveWebhook() {
  var url = document.getElementById('webhook-input').value.trim();
  var msg = document.getElementById('webhook-msg');
  try {
    await window.PATCH('/api/settings', { webhook_url: url });
    msg.textContent = url ? 'Webhook zapisany.' : 'Webhook wyłączony.';
    msg.style.color = 'var(--pos)';
    msg.style.display = 'block';
    setTimeout(function() { msg.style.display = 'none'; }, 3000);
  } catch(e) {
    msg.textContent = 'Błąd: ' + e.message;
    msg.style.color = 'var(--neg)';
    msg.style.display = 'block';
  }
};

window.saveCron = async function saveCron() {
  var cron = document.getElementById('cron-input').value.trim();
  var msg = document.getElementById('cron-msg');
  try {
    await window.PATCH('/api/settings', { backup_cron: cron });
    msg.textContent = 'Harmonogram zapisany.';
    msg.style.color = 'var(--pos)';
    msg.style.display = 'block';
    setTimeout(function() { msg.style.display = 'none'; }, 3000);
  } catch(e) {
    msg.textContent = 'Błąd: ' + e.message;
    msg.style.color = 'var(--neg)';
    msg.style.display = 'block';
  }
};

window.exportData = async function exportData() {
  var a = document.createElement('a');
  a.href = '/api/export';
  a.download = '';
  a.click();
};

window.importData = async function importData(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!confirm('Import nadpisze wszystkie istniejące dane. Kontynuować?')) {
    event.target.value = '';
    return;
  }
  try {
    var text = await file.text();
    var data = JSON.parse(text);
    var res  = await window.POST('/api/import', data);
    alert('Import zakończony: ' + res.imported.accounts + ' kont, ' + res.imported.snapshots + ' snapshotów, ' + res.imported.entries + ' wpisów, ' + (res.imported.milestones || 0) + ' celów.');
    await window.refresh();
    window.renderDashboard();
  } catch(e) {
    alert('Błąd importu: ' + e.message);
  }
  event.target.value = '';
};

})();
