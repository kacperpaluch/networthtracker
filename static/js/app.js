(function() {

window.S = {
  accounts: [],
  snapshots: [],
  series: [],
  breakdown: null,
  summary: null,
  monthlyChanges: [],
  milestones: [],
  settings: null,
  editingSnapshotId: null,
  editingAccountId: null,
};

window._chartNW = null;
window._chartBreakdown = null;
window._chartDonut = null;
window._chartMonthly = null;

window.loadAll = async function loadAll() {
  var results = await Promise.all([
    window.GET('/api/accounts?include_archived=true'),
    window.GET('/api/snapshots'),
    window.GET('/api/networth/series'),
    window.GET('/api/networth/breakdown'),
    window.GET('/api/stats/summary'),
    window.GET('/api/stats/monthly'),
    window.GET('/api/milestones'),
    window.GET('/api/settings'),
  ]);
  window.S.accounts        = results[0];
  window.S.snapshots       = results[1];
  window.S.series          = results[2];
  window.S.breakdown       = results[3];
  window.S.summary         = results[4];
  window.S.monthlyChanges  = results[5];
  window.S.milestones      = results[6];
  window.S.settings        = results[7];
};

window.refresh = window.loadAll;

window.refreshIcons = function() {
  if (window.lucide) {
    try { window.lucide.createIcons(); } catch(e) { /* ignore */ }
  }
};

window.switchTab = function switchTab(tab) {
  var panels = document.querySelectorAll('.tab-panel');
  for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
  var tabs = document.querySelectorAll('.nav-tab');
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
  document.getElementById('tab-' + tab).classList.add('active');
  var btn = document.querySelector('.nav-tab[data-tab="' + tab + '"]');
  if (btn) btn.classList.add('active');
  if (tab === 'dashboard') window.renderDashboard();
  if (tab === 'history')   window.renderHistory();
  if (tab === 'accounts')  window.renderAccounts();
  if (tab === 'backup')    { window.loadBackups(); window.loadCronSetting(); }
};

window.init = async function init() {
  await window.loadAll();
  window.renderDashboard();
  window.refreshIcons();

  // Navbar scroll effect
  var nav = document.getElementById('main-nav');
  if (nav) {
    var onScroll = function() {
      nav.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
};

window.init();

})();
