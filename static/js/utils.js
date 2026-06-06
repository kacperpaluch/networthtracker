(function() {

// API helpers
window.api = async function api(method, url, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({detail: r.statusText}));
    throw new Error(err.detail || r.statusText);
  }
  return r.json();
};
window.GET    = url       => window.api('GET',    url);
window.POST   = (url, b) => window.api('POST',   url, b);
window.PATCH  = (url, b) => window.api('PATCH',  url, b);
window.DELETE = url       => window.api('DELETE', url);

// Formatting
window.fmtCurrency = function fmtCurrency(v) {
  if (v === null || v === undefined) return '\u2014';
  return new Intl.NumberFormat('pl-PL', {
    style:'currency', currency:'PLN',
    minimumFractionDigits:2, maximumFractionDigits:2
  }).format(v);
};
window.fmtPct = function fmtPct(v) {
  if (v === null || v === undefined) return null;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
};
window.fmtDate = function fmtDate(d) {
  if (!d) return '';
  const [y,m,day] = d.split('-');
  return `${day}.${m}.${y}`;
};
window.changeHtml = function changeHtml(amount, pct, showArrow) {
  if (showArrow === undefined) showArrow = true;
  if (amount === undefined || amount === null) return '';
  const pos = amount >= 0;
  const cls = pos ? 'text-pos' : 'text-neg';
  const arrow = showArrow ? (pos ? '\u25B2 ' : '\u25BC ') : '';
  let txt = arrow + window.fmtCurrency(Math.abs(amount));
  if (pct !== null && pct !== undefined) txt += ' (' + Math.abs(pct).toFixed(1) + '%)';
  return '<span class="' + cls + '">' + txt + '</span>';
};

// Modal helpers
window.openModal = function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
};
window.closeModal = function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
};

// Utility
window.esc = function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

// Escape key handler
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(function(m) {
      window.closeModal(m.id);
    });
  }
});

})();
