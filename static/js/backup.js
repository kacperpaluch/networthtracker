(function() {

// Backup
window.showBackupMsg = function showBackupMsg(text, ok) {
  var el = document.getElementById('backup-msg');
  el.textContent = text;
  el.style.display = '';
  el.style.background  = ok ? 'var(--green-bg)'  : 'var(--red-bg)';
  el.style.color       = ok ? 'var(--green)'     : 'var(--red)';
  el.style.border      = ok ? '1px solid rgba(16,185,129,.3)' : '1px solid rgba(248,81,73,.3)';
  setTimeout(function() { el.style.display = 'none'; }, 5000);
};

window.loadBackups = async function loadBackups() {
  try {
    var backups = await window.GET('/api/backup/list');
    window.renderBackups(backups);
  } catch(e) {
    document.getElementById('backup-tbody').innerHTML = '';
    document.getElementById('backup-empty').style.display = '';
    document.getElementById('backup-empty').textContent = 'Blad ladowania listy backupow.';
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
      '<td class="td-actions">' +
      '<button class="btn btn-ghost btn-sm btn-icon" onclick="downloadBackup(\'' + window.esc(b.filename) + '\')" title="Pobierz">' +
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/><path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.97a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.779a.749.749 0 1 1 1.06-1.06l1.97 1.97Z"/></svg>' +
      '</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="restoreFromServer(\'' + window.esc(b.filename) + '\')" title="Przywroc">Przywroc</button>' +
      '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteBackup(\'' + window.esc(b.filename) + '\')" title="Usun">' +
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>' +
      '</button></td></tr>';
  }).join('');
};

window.createBackup = async function createBackup() {
  try {
    await window.POST('/api/backup/create', {});
    window.showBackupMsg('Backup utworzony pomyslnie!', true);
    await window.loadBackups();
  } catch(e) { window.showBackupMsg('Blad tworzenia backupu: ' + e.message, false); }
};

window.downloadBackup = function downloadBackup(filename) {
  var a = document.createElement('a');
  a.href = '/api/backup/download/' + encodeURIComponent(filename);
  a.download = filename;
  a.click();
};

window.restoreFromServer = async function restoreFromServer(filename) {
  if (!confirm('Przywrocic backup "' + filename + '"?\nBiezace dane zostana nadpisane.')) return;
  try {
    await window.POST('/api/backup/restore/' + encodeURIComponent(filename), {});
    window.showBackupMsg('Backup przywrocony pomyslnie!', true);
    await window.refresh();
    window.renderDashboard();
  } catch(e) { window.showBackupMsg('Blad przywracania: ' + e.message, false); }
};

window.restoreFromUpload = async function restoreFromUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!confirm('Wczytac plik "' + file.name + '" i nadpisac biezace dane?')) {
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
    window.showBackupMsg('Plik przywrocony pomyslnie!', true);
    await window.refresh();
    window.renderDashboard();
  } catch(e) { window.showBackupMsg('Blad wczytywania pliku: ' + e.message, false); }
  event.target.value = '';
};

window.deleteBackup = async function deleteBackup(filename) {
  if (!confirm('Usunac backup "' + filename + '"?')) return;
  try {
    var r = await fetch('/api/backup/' + encodeURIComponent(filename), { method: 'DELETE' });
    if (!r.ok) {
      var err = await r.json().catch(function() { return { detail: r.statusText }; });
      throw new Error(err.detail || r.statusText);
    }
    await window.loadBackups();
  } catch(e) { window.showBackupMsg('Blad usuwania: ' + e.message, false); }
};

// Cron settings
window.loadCronSetting = async function loadCronSetting() {
  try {
    var s = await window.GET('/api/settings');
    document.getElementById('cron-input').value = s.backup_cron || '0 4 * * *';
  } catch(e) { /* ignore */ }
};

window.saveCron = async function saveCron() {
  var cron = document.getElementById('cron-input').value.trim();
  var msg = document.getElementById('cron-msg');
  try {
    await window.PATCH('/api/settings', { backup_cron: cron });
    msg.textContent = 'Harmonogram zapisany.';
    msg.style.color = 'var(--green, #22c55e)';
    msg.style.display = '';
    setTimeout(function() { msg.style.display = 'none'; }, 3000);
  } catch(e) {
    msg.textContent = 'Blad: ' + e.message;
    msg.style.color = 'var(--red, #ef4444)';
    msg.style.display = '';
  }
};

// Export / Import
window.exportData = async function exportData() {
  var a = document.createElement('a');
  a.href = '/api/export';
  a.download = '';
  a.click();
};

window.importData = async function importData(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!confirm('Import nadpisze wszystkie istniejace dane. Kontynuowac?')) {
    event.target.value = '';
    return;
  }
  try {
    var text = await file.text();
    var data = JSON.parse(text);
    var res  = await window.POST('/api/import', data);
    alert('Import zakonczony: ' + res.imported.accounts + ' kont, ' + res.imported.snapshots + ' snapshotow, ' + res.imported.entries + ' wpisow.');
    await window.refresh();
    window.renderDashboard();
  } catch(e) {
    alert('Blad importu: ' + e.message);
  }
  event.target.value = '';
};

})();
