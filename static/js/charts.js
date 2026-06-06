(function() {

var ASSET_COLORS = ['#10b981','#3b82f6','#8b5cf6','#06b6d4','#84cc16','#f59e0b','#14b8a6','#a78bfa','#34d399','#60a5fa'];
var LIAB_COLORS  = ['#f85149','#f97316','#ec4899','#fb923c','#e11d48','#dc2626'];

window.renderNetworthChart = function renderNetworthChart() {
  var canvas = document.getElementById('chart-nw');
  if (window._chartNW) { window._chartNW.destroy(); window._chartNW = null; }
  var series = window.S.series;
  if (!series.length) return;

  var labels = series.map(function(s) { return s.date; });
  var data   = series.map(function(s) { return s.net_worth; });
  var lastVal = data[data.length-1];
  var lineColor = (lastVal != null && lastVal >= 0) ? '#10b981' : '#f85149';

  function splitGradient(ctx) {
    var chart = ctx.chart;
    var chartArea = chart.chartArea;
    var scales = chart.scales;
    if (!chartArea || !scales.y) return 'transparent';
    var top = chartArea.top, bottom = chartArea.bottom;
    var zeroY = Math.max(top, Math.min(bottom, scales.y.getPixelForValue(0)));
    var ratio = (zeroY - top) / (bottom - top);
    var g = chart.ctx.createLinearGradient(0, top, 0, bottom);
    if (ratio > 0) {
      g.addColorStop(0, '#10b98128');
      g.addColorStop(Math.min(ratio, 1), '#10b98108');
    }
    if (ratio < 1) {
      g.addColorStop(Math.max(ratio, 0), '#f8514918');
      g.addColorStop(1, '#f8514908');
    }
    return g;
  }

  window._chartNW = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Wartosc netto',
        data: data,
        borderColor: lineColor,
        backgroundColor: splitGradient,
        fill: 'origin',
        tension: 0.4,
        pointRadius: series.length <= 12 ? 4 : 2,
        pointHoverRadius: 6,
        pointBackgroundColor: lineColor,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2430',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: function(items) { return window.fmtDate(items[0].label); },
            label: function(ctx) { return ' ' + window.fmtCurrency(ctx.raw); },
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: series.length <= 18 ? 'month' : 'quarter', tooltipFormat: 'yyyy-MM-dd' },
          grid: { color: '#21262d' },
          ticks: { color: '#8b949e', maxTicksLimit: 10 }
        },
        y: {
          grid: { color: '#21262d' },
          ticks: { color: '#8b949e', callback: function(v) { return window.fmtCurrency(v); } }
        }
      }
    }
  });
};

window.renderBreakdownChart = function renderBreakdownChart() {
  var canvas = document.getElementById('chart-breakdown');
  if (window._chartBreakdown) { window._chartBreakdown.destroy(); window._chartBreakdown = null; }
  var bd = window.S.breakdown;
  if (!bd || !bd.dates.length) return;

  var ai = 0, li = 0;
  var datasets = bd.datasets.map(function(d) {
    var isAsset = d.type === 'asset';
    var color = isAsset ? ASSET_COLORS[ai++ % ASSET_COLORS.length] : LIAB_COLORS[li++ % LIAB_COLORS.length];
    return {
      label: d.name,
      data: d.values,
      backgroundColor: color + 'aa',
      borderColor: color,
      borderWidth: 1,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
    };
  });

  var nwData = bd.dates.map(function(_, i) {
    return bd.datasets.reduce(function(sum, d) { return sum + (d.values[i] || 0); }, 0);
  });
  datasets.push({
    label: 'Net Worth',
    data: nwData,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderDash: [4, 3],
    fill: false,
    tension: 0.4,
    pointRadius: 0,
    pointHoverRadius: 5,
    order: -1,
  });

  window._chartBreakdown = new Chart(canvas, {
    type: 'line',
    data: { labels: bd.dates, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#8b949e', padding: 10, font: { size: 11 }, boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: '#1c2430',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: function(items) { return window.fmtDate(items[0].label); },
            label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + window.fmtCurrency(ctx.raw); },
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: bd.dates.length <= 18 ? 'month' : 'quarter', tooltipFormat: 'yyyy-MM-dd' },
          grid: { color: '#21262d' },
          ticks: { color: '#8b949e', maxTicksLimit: 10 }
        },
        y: {
          stacked: true,
          grid: { color: '#21262d' },
          ticks: { color: '#8b949e', callback: function(v) { return window.fmtCurrency(v); } }
        }
      }
    }
  });
};

})();
