(function() {

// Earth-tone palette for data viz — warm yellow primary, distinct from brand green
var ASSET_COLORS = [
  '#E8D87A', // warm yellow (primary)
  '#C9A36A', // amber
  '#8B9D77', // sage
  '#B8A0C9', // muted violet
  '#7BA7BC', // dusty blue
  '#D9A574', // sand
  '#9CAF88', // olive
  '#C4A0A0', // dusty rose
  '#A8B5A0', // sage light
  '#D4B896', // wheat
];
var LIAB_COLORS = [
  '#D14343', '#C97070', '#B86A6A', '#A85555', '#E07575', '#C24848',
];

var TEXT_PRIMARY = '#111111';
var TEXT_MUTED   = '#999999';
var GRID_COLOR   = '#F0F0F0';
var TOOLTIP_BG   = '#111111';
var TOOLTIP_FG   = '#FFFFFF';
var TOOLTIP_MUTE = '#999999';

var FONT_FAMILY = "'Inter', system-ui, sans-serif";

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: TEXT_MUTED,
          padding: 12,
          font: { family: FONT_FAMILY, size: 11, weight: '500' },
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: TOOLTIP_BG,
        borderColor: '#222',
        borderWidth: 1,
        titleColor: TOOLTIP_MUTE,
        bodyColor: TOOLTIP_FG,
        padding: 10,
        titleFont: { family: FONT_FAMILY, size: 11, weight: '500' },
        bodyFont: { family: FONT_FAMILY, size: 12, weight: '500' },
        cornerRadius: 8,
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        usePointStyle: true,
      },
    },
    scales: {
      x: {
        type: 'time',
        grid: { color: GRID_COLOR, drawBorder: false },
        ticks: { color: TEXT_MUTED, font: { family: FONT_FAMILY, size: 11 }, maxTicksLimit: 10 },
        border: { color: GRID_COLOR },
      },
      y: {
        grid: { color: GRID_COLOR, drawBorder: false },
        ticks: {
          color: TEXT_MUTED,
          font: { family: FONT_FAMILY, size: 11 },
          callback: function(v) { return window.fmtCurrency(v); },
        },
        border: { color: GRID_COLOR },
      },
    },
  };
}

window.renderNetworthChart = function renderNetworthChart() {
  var canvas = document.getElementById('chart-nw');
  if (window._chartNW) { window._chartNW.destroy(); window._chartNW = null; }
  var series = window.S.series;
  if (!series.length) return;

  var labels = series.map(function(s) { return s.date; });
  var data   = series.map(function(s) { return s.net_worth; });
  var lastVal = data[data.length - 1];
  // Brand-neutral dark line; warm yellow fill so chart reads as data viz, not brand
  var lineColor = TEXT_PRIMARY;

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
      g.addColorStop(0, 'rgba(232,216,122,0.35)');
      g.addColorStop(Math.min(ratio, 1), 'rgba(232,216,122,0.05)');
    }
    if (ratio < 1) {
      g.addColorStop(Math.max(ratio, 0), 'rgba(209,67,67,0.12)');
      g.addColorStop(1, 'rgba(209,67,67,0.02)');
    }
    return g;
  }

  var smaWindow = 3;
  var smaData = [];
  for (var i = 0; i < data.length; i++) {
    if (i < smaWindow - 1) { smaData.push(null); continue; }
    var sum = 0;
    for (var j = i - smaWindow + 1; j <= i; j++) sum += data[j];
    smaData.push(sum / smaWindow);
  }

  var projLabels = [].concat(labels);
  var projData = [];
  for (var k = 0; k < data.length - 1; k++) projData.push(null);
  projData.push(data[data.length - 1]);
  var hasProj = false;

  if (data.length >= 4) {
    var projCount = Math.min(6, Math.ceil(data.length / 2));
    var nPts = Math.min(data.length, 12);
    var startIdx = data.length - nPts;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var pi = startIdx; pi < data.length; pi++) {
      var x = pi - startIdx;
      var y = data[pi];
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
    }
    var slope = (nPts * sumXY - sumX * sumY) / (nPts * sumX2 - sumX * sumX);
    var intercept = (sumY - slope * sumX) / nPts;

    var lastDate = new Date(labels[labels.length - 1] + 'T00:00:00');
    var avgDays = labels.length >= 2
      ? Math.round((new Date(labels[labels.length - 1] + 'T00:00:00') - new Date(labels[0] + 'T00:00:00')) / 86400000 / (labels.length - 1))
      : 30;
    if (avgDays < 1) avgDays = 30;

    for (var fp = 1; fp <= projCount; fp++) {
      var nextDate = new Date(lastDate);
      nextDate.setDate(nextDate.getDate() + avgDays * fp);
      projLabels.push(nextDate.toISOString().slice(0, 10));
      projData.push(Math.round((intercept + slope * (nPts - 1 + fp)) * 100) / 100);
    }
    hasProj = true;
  }

  var datasets = [{
    label: 'Wartość netto',
    data: data,
    borderColor: lineColor,
    backgroundColor: splitGradient,
    fill: 'origin',
    tension: 0.4,
    pointRadius: series.length <= 12 ? 4 : 2,
    pointHoverRadius: 6,
    pointBackgroundColor: '#FFFFFF',
    pointBorderColor: lineColor,
    pointBorderWidth: 2,
    borderWidth: 2.5,
  }];

  if (data.length >= smaWindow) {
    datasets.push({
      label: 'SMA (' + smaWindow + ')',
      data: smaData,
      borderColor: '#999999',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [5, 3],
      fill: false,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 3,
      order: 1,
    });
  }

  if (hasProj) {
    datasets.push({
      label: 'Prognoza',
      data: projData,
      borderColor: 'rgba(17,17,17,0.4)',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [6, 4],
      fill: false,
      tension: 0.3,
      pointRadius: 2,
      pointHoverRadius: 4,
      pointBackgroundColor: 'rgba(17,17,17,0.4)',
      order: 0,
    });
  }

  var chartLabels = hasProj ? projLabels : labels;
  var opts = baseChartOptions();
  opts.scales.x.time = { unit: labels.length <= 18 ? 'month' : 'quarter', tooltipFormat: 'yyyy-MM-dd' };
  opts.plugins.tooltip.callbacks = {
    title: function(items) { return window.fmtDate(items[0].label); },
    label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + window.fmtCurrency(ctx.raw); },
  };

  window._chartNW = new Chart(canvas, { type: 'line', data: { labels: chartLabels, datasets: datasets }, options: opts });
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
      backgroundColor: color,
      borderColor: color,
      borderWidth: 0,
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
    borderColor: TEXT_PRIMARY,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderDash: [4, 3],
    fill: false,
    tension: 0.4,
    pointRadius: 0,
    pointHoverRadius: 5,
    order: -1,
  });

  var opts = baseChartOptions();
  opts.scales.y.stacked = true;
  opts.scales.x.time = { unit: bd.dates.length <= 18 ? 'month' : 'quarter', tooltipFormat: 'yyyy-MM-dd' };
  opts.plugins.tooltip.callbacks = {
    title: function(items) { return window.fmtDate(items[0].label); },
    label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + window.fmtCurrency(ctx.raw); },
  };

  window._chartBreakdown = new Chart(canvas, { type: 'line', data: { labels: bd.dates, datasets: datasets }, options: opts });
};

window.renderAllocationDonut = function renderAllocationDonut() {
  var canvas = document.getElementById('chart-donut');
  if (window._chartDonut) { window._chartDonut.destroy(); window._chartDonut = null; }
  var structure = window.S.summary && window.S.summary.asset_structure;
  if (!structure || !structure.length) return;

  var assets = structure.filter(function(a) { return a.type === 'asset' && a.value > 0; });
  if (!assets.length) return;

  var hasCategories = assets.some(function(a) { return a.category; });
  var labels, values;
  if (hasCategories) {
    var byCat = {};
    assets.forEach(function(a) {
      var cat = a.category || 'Bez kategorii';
      byCat[cat] = (byCat[cat] || 0) + a.value;
    });
    labels = Object.keys(byCat).sort(function(x, y) { return byCat[y] - byCat[x]; });
    values = labels.map(function(c) { return byCat[c]; });
  } else {
    labels = assets.map(function(a) { return a.name; });
    values = assets.map(function(a) { return a.value; });
  }
  var colors = labels.map(function(_, i) { return ASSET_COLORS[i % ASSET_COLORS.length]; });

  window._chartDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: '#FFFFFF',
        borderWidth: 2,
        hoverBorderColor: '#FFFFFF',
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      animation: { animateRotate: true, duration: 600 },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: TEXT_MUTED,
            padding: 10,
            font: { family: FONT_FAMILY, size: 11, weight: '500' },
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'circle',
          }
        },
        tooltip: {
          backgroundColor: TOOLTIP_BG,
          borderColor: '#222',
          borderWidth: 1,
          titleColor: TOOLTIP_MUTE,
          bodyColor: TOOLTIP_FG,
          padding: 10,
          titleFont: { family: FONT_FAMILY, size: 11, weight: '500' },
          bodyFont: { family: FONT_FAMILY, size: 12, weight: '500' },
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          callbacks: {
            label: function(ctx) {
              var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct = ((ctx.raw / total) * 100).toFixed(1);
              return ' ' + ctx.label + ': ' + window.fmtCurrency(ctx.raw) + ' (' + pct + '%)';
            }
          }
        }
      }
    }
  });
};

window.renderMonthlyChart = function renderMonthlyChart() {
  var canvas = document.getElementById('chart-monthly');
  if (window._chartMonthly) { window._chartMonthly.destroy(); window._chartMonthly = null; }
  var monthly = window.S.monthlyChanges;
  if (!monthly || !monthly.length) return;

  var changes = monthly.filter(function(m) { return m.change !== null; });
  if (!changes.length) return;

  var labels = changes.map(function(m) { return m.month + '-01'; });
  var values = changes.map(function(m) { return m.change; });
  // Warm yellow for positive (data viz), muted red for negative — independent of brand green
  var posColor = '#E8D87A';
  var negColor = '#D14343';
  var bgColors = values.map(function(v) { return v >= 0 ? posColor : negColor; });
  var borderColors = values.map(function(v) { return v >= 0 ? '#C9B85E' : '#A83636'; });

  window._chartMonthly = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Zmiana miesięczna',
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 36,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: TOOLTIP_BG,
          borderColor: '#222',
          borderWidth: 1,
          titleColor: TOOLTIP_MUTE,
          bodyColor: TOOLTIP_FG,
          padding: 10,
          titleFont: { family: FONT_FAMILY, size: 11, weight: '500' },
          bodyFont: { family: FONT_FAMILY, size: 12, weight: '500' },
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title: function(items) { var d = items[0].label; return d.slice(0, 7); },
            label: function(ctx) { return ' ' + window.fmtCurrency(ctx.raw); },
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', tooltipFormat: 'yyyy-MM', displayFormats: { month: 'MM/yy' } },
          grid: { display: false },
          ticks: { color: TEXT_MUTED, font: { family: FONT_FAMILY, size: 11 }, maxTicksLimit: 12 },
          border: { color: GRID_COLOR },
        },
        y: {
          grid: { color: GRID_COLOR, drawBorder: false },
          ticks: { color: TEXT_MUTED, font: { family: FONT_FAMILY, size: 11 }, callback: function(v) { return window.fmtCurrency(v); } },
          border: { color: GRID_COLOR },
        }
      }
    }
  });
};

})();
