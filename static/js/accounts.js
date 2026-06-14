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
      var archBadge = a.archived ? '<span class="badge-archived">Zarchiwizowane</span>' : '';
      var catBadge = a.category ? '<span class="badge-category">' + window.esc(a.category) + '</span>' : '';
      var typeBadge = a.type === 'asset'
        ? '<span class="account-badge badge-asset"><i data-lucide="trending-up" style="width:11px;height:11px"></i> Aktywo</span>'
        : '<span class="account-badge badge-liability"><i data-lucide="trending-down" style="width:11px;height:11px"></i> Zobowiązanie</span>';
      html += '<div class="account-row ' + (a.archived ? 'archived' : '') + '">' +
        '<span class="account-name">' + window.esc(a.name) + '</span>' +
        catBadge +
        archBadge +
        typeBadge +
        '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-icon" onclick="openAccountModal(' + a.id + ')" title="Edytuj">' +
        '<i data-lucide="pencil" class="icon-sm"></i>' +
        '</button>' +
        (!a.archived
          ? '<button class="btn btn-icon" onclick="archiveAccount(' + a.id + ')" title="Archiwizuj" style="color:var(--amber)">' +
            '<i data-lucide="archive" class="icon-sm"></i>' +
            '</button>'
          : '<button class="btn btn-icon" onclick="restoreAccount(' + a.id + ')" title="Przywróć" style="color:var(--pos)">' +
            '<i data-lucide="archive-restore" class="icon-sm"></i>' +
            '</button>'
        ) +
        '<button class="btn btn-icon" onclick="deleteAccount(' + a.id + ')" title="Usuń" style="color:var(--neg)">' +
        '<i data-lucide="trash-2" class="icon-sm"></i>' +
        '</button></div></div>';
    });
    html += '</div>';
  }

  renderGroup(assets, 'Aktywa');
  renderGroup(liabs, 'Zobowiązania');
  el.innerHTML = html;
  window.refreshIcons();
};

window.openAccountModal = function openAccountModal(accountId) {
  window.S.editingAccountId = accountId || null;
  var acc = accountId ? window.S.accounts.find(function(a) { return a.id === accountId; }) : null;
  document.getElementById('account-modal-title').textContent = acc ? 'Edytuj konto' : 'Nowe konto';
  document.getElementById('account-name').value = acc ? acc.name : '';
  document.getElementById('account-type').value = acc ? acc.type : 'asset';
  document.getElementById('account-category').value = acc ? (acc.category || '') : '';
  window.openModal('modal-account-overlay');
  setTimeout(function() { document.getElementById('account-name').focus(); }, 50);
};

window.saveAccount = async function saveAccount() {
  var name = document.getElementById('account-name').value.trim();
  var type = document.getElementById('account-type').value;
  var category = document.getElementById('account-category').value.trim();
  if (!name) { alert('Podaj nazwę konta.'); return; }
  try {
    if (window.S.editingAccountId) {
      await window.PATCH('/api/accounts/' + window.S.editingAccountId, { name: name, type: type, category: category });
    } else {
      await window.POST('/api/accounts', { name: name, type: type, category: category || null });
    }
    window.closeModal('modal-account-overlay');
    await window.refresh();
    window.renderAccounts();
    window.renderDashboard();
  } catch(e) { alert('Błąd: ' + e.message); }
};

window.archiveAccount = async function archiveAccount(id) {
  if (!confirm('Zarchiwizować to konto? Zniknie z formularza nowych snapshotów, ale historia pozostanie.')) return;
  try {
    await window.PATCH('/api/accounts/' + id, { archived: 1 });
    await window.refresh();
    window.renderAccounts();
  } catch(e) { alert('Błąd: ' + e.message); }
};

window.restoreAccount = async function restoreAccount(id) {
  try {
    await window.PATCH('/api/accounts/' + id, { archived: 0 });
    await window.refresh();
    window.renderAccounts();
  } catch(e) { alert('Błąd: ' + e.message); }
};

window.deleteAccount = async function deleteAccount(id) {
  if (!confirm('Trwale usunąć to konto? Możliwe tylko gdy nie ma żadnych wpisów.')) return;
  try {
    await window.DELETE('/api/accounts/' + id);
    await window.refresh();
    window.renderAccounts();
  } catch(e) { alert('Błąd: ' + e.message); }
};

})();
