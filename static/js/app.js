(function() {

// State
window.S = {
  accounts: [],
  snapshots: [],
  series: [],
  breakdown: null,
  summary: null,
  editingSnapshotId: null,
  editingAccountId: null,
};

// Runtime chart references (used by charts.js)
window._chartNW = null;
window._chartBreakdown = null;

// Load all data
window.loadAll = async function loadAll() {
  var results = await Promise.all([
    window.GET('/api/accounts?include_archived=true'),
    window.GET('/api/snapshots'),
    window.GET('/api/networth/series'),
    window.GET('/api/networth/breakdown'),
    window.GET('/api/stats/summary'),
  ]);
  window.S.accounts  = results[0];
  window.S.snapshots = results[1];
  window.S.series    = results[2];
  window.S.breakdown = results[3];
  window.S.summary   = results[4];
};

// Tab switching
window.switchTab = function switchTab(tab) {
  var panels = document.querySelectorAll('.tab-panel');
  for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
  var tabs = document.querySelectorAll('.nav-tab');
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
  document.getElementById('tab-' + tab).classList.add('active');
  var tabNames = ['dashboard','history','accounts','backup'];
  document.querySelectorAll('.nav-tab')[tabNames.indexOf(tab)].classList.add('active');
  if (tab === 'dashboard') window.renderDashboard();
  if (tab === 'history')   window.renderHistory();
  if (tab === 'accounts')  window.renderAccounts();
  if (tab === 'backup')    { window.loadBackups(); window.loadCronSetting(); }
};

// Refresh all data
window.refresh = async function refresh() {
  var results = await Promise.all([
    window.GET('/api/accounts?include_archived=true'),
    window.GET('/api/snapshots'),
    window.GET('/api/networth/series'),
    window.GET('/api/networth/breakdown'),
    window.GET('/api/stats/summary'),
  ]);
  window.S.accounts  = results[0];
  window.S.snapshots = results[1];
  window.S.series    = results[2];
  window.S.breakdown = results[3];
  window.S.summary   = results[4];
};

// Init
window.init = async function init() {
  await window.loadAll();
  window.renderDashboard();
};

window.init();

})();
