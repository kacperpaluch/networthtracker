(function() {

window.renderAccounts = function renderAccounts() {
  var showArchived = document.getElementById('show-archived') ? document.getElementById('show-archived').checked : false;
  var filtered = showArchived ? window.S.accounts : window.S.accounts.filter(function(a) { return !a.archived; });
  var assets = filtered.filter(function(a) { return a.type === 'asset'; });
  var liabs  = filtered.filter(function(a) { return a.type === 'liability'; });
  var el = document.getElementById('accounts-list');

  if (!filtered.length) {
    el.innerHTML = '<p class="text-muted" style="padding:12px 0">Brak kont. Dodaj pierwsze konto.</p>';
    return;
  }

  var html = '';
  function renderGroup(accounts, label) {
    if (!accounts.length) return;
    html += '<div class="accounts-group"><div class="accounts-group-title">' + label + '</div>';
    accounts.forEach(function(a) {
      var archBadge = a.archived ? '<span class="badge-archived">zarchiwizowane</span>' : '';
      html += '<div class="account-row ' + (a.archived ? 'archived' : '') + '">' +
        '<span class="account-name">' + window.esc(a.name) + '</span>' +
        archBadge +
        '<span class="account-badge ' + (a.type === 'asset' ? 'badge-asset' : 'badge-liability') + '">' + (a.type === 'asset' ? 'Aktywo' : 'Zobowiazanie') + '</span>' +
        '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-icon" onclick="openAccountModal(' + a.id + ')" title="Edytuj">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/></svg>' +
        '</button>' +
        (!a.archived
          ? '<button class="btn btn-icon" onclick="archiveAccount(' + a.id + ')" title="Archiwizuj" style="color:var(--amber)">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v1.5A1.75 1.75 0 0 1 14.25 6H1.75A1.75 1.75 0 0 1 0 4.25ZM1.75 7a.75.75 0 0 1 .75.75v5.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-5.5a.75.75 0 0 1 1.5 0v5.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25v-5.5A.75.75 0 0 1 1.75 7Zm4.5 1a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-3.25a.75.75 0 0 1-.75-.75v-3.25A.75.75 0 0 1 6.25 8Z"/></svg>' +
            '</button>'
          : '<button class="btn btn-icon" onclick="restoreAccount(' + a.id + ')" title="Przywroc" style="color:var(--green)">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.22 1.22a.75.75 0 0 1 1.06 0L4.5 3.44V2.25a.75.75 0 0 1 1.5 0V5.5a.75.75 0 0 1-.75.75H2a.75.75 0 0 1 0-1.5h1.19L1.22 2.28a.75.75 0 0 1 0-1.06ZM7.75 4a.75.75 0 0 1 .75.75V7h2.25a.75.75 0 0 1 0 1.5H7.75a.75.75 0 0 1-.75-.75v-3A.75.75 0 0 1 7.75 4Zm-6 4a6.25 6.25 0 1 1 12.5 0 6.25 6.25 0 0 1-12.5 0Zm6.25-4.75a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5Z"/></svg>' +
            '</button>'
        ) +
        '<button class="btn btn-icon" onclick="deleteAccount(' + a.id + ')" title="Usun" style="color:var(--red)">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>' +
        '</button></div></div>';
    });
    html += '</div>';
  }

  renderGroup(assets, 'Aktywa');
  renderGroup(liabs, 'Zobowiazania');
  el.innerHTML = html;
};

// Account modal
window.openAccountModal = function openAccountModal(accountId) {
  window.S.editingAccountId = accountId || null;
  var acc = accountId ? window.S.accounts.find(function(a) { return a.id === accountId; }) : null;
  document.getElementById('account-modal-title').textContent = acc ? 'Edytuj konto' : 'Nowe konto';
  document.getElementById('account-name').value = acc ? acc.name : '';
  document.getElementById('account-type').value = acc ? acc.type : 'asset';
  window.openModal('modal-account-overlay');
  setTimeout(function() { document.getElementById('account-name').focus(); }, 50);
};

window.saveAccount = async function saveAccount() {
  var name = document.getElementById('account-name').value.trim();
  var type = document.getElementById('account-type').value;
  if (!name) { alert('Podaj nazwe konta.'); return; }
  try {
    if (window.S.editingAccountId) {
      await window.PATCH('/api/accounts/' + window.S.editingAccountId, { name: name, type: type });
    } else {
      await window.POST('/api/accounts', { name: name, type: type });
    }
    window.closeModal('modal-account-overlay');
    await window.refresh();
    window.renderAccounts();
    window.renderDashboard();
  } catch(e) { alert('Blad: ' + e.message); }
};

window.archiveAccount = async function archiveAccount(id) {
  if (!confirm('Zarchiwizowac to konto? Zniknie z formularza nowych snapshotow, ale historia pozostanie.')) return;
  try {
    await window.PATCH('/api/accounts/' + id, { archived: 1 });
    await window.refresh();
    window.renderAccounts();
  } catch(e) { alert('Blad: ' + e.message); }
};

window.restoreAccount = async function restoreAccount(id) {
  try {
    await window.PATCH('/api/accounts/' + id, { archived: 0 });
    await window.refresh();
    window.renderAccounts();
  } catch(e) { alert('Blad: ' + e.message); }
};

window.deleteAccount = async function deleteAccount(id) {
  if (!confirm('Trwale usunac to konto? Mozliwe tylko gdy nie ma zadnych wpisow.')) return;
  try {
    await window.DELETE('/api/accounts/' + id);
    await window.refresh();
    window.renderAccounts();
  } catch(e) { alert('Blad: ' + e.message); }
};

})();
