window.SSCharts = {};

const PALETTE = {
  blue:   { border: '#2563EB', bg: 'rgba(37,99,235,0.12)' },
  green:  { border: '#059669', bg: 'rgba(5,150,105,0.12)' },
  purple: { border: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
  orange: { border: '#EA580C', bg: 'rgba(234,88,12,0.12)' },
  pink:   { border: '#DB2777', bg: 'rgba(219,39,119,0.12)' },
  indigo: { border: '#4F46E5', bg: 'rgba(79,70,229,0.12)' },
};
const MULTI = ['#2563EB','#059669','#7C3AED','#EA580C','#DB2777','#4F46E5','#D97706','#DC2626'];

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { font: { family: "'Inter',sans-serif", size: 12 }, color: '#64748B', boxWidth: 12, padding: 16 } },
    tooltip: {
      backgroundColor: '#0F172A', titleColor: '#F8FAFC', bodyColor: '#CBD5E1',
      padding: 12, cornerRadius: 8, titleFont: { weight: '600' },
    },
  },
};

function destroyIfExists(ctx) {
  if (!ctx || typeof Chart === 'undefined') return;
  const canvas = ctx instanceof HTMLCanvasElement ? ctx : ctx.canvas;
  if (canvas) {
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
  }
}

SSCharts.line = function(ctx, labels, data, { color = 'blue', label = 'Value', yPrefix = '' } = {}) {
  if (!ctx || typeof Chart === 'undefined') return null;
  destroyIfExists(ctx);
  const c = PALETTE[color] || PALETTE.blue;
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label, data,
        borderColor: c.border, backgroundColor: c.bg,
        fill: true, tension: 0.4, pointRadius: 4,
        pointBackgroundColor: c.border, pointBorderColor: '#fff', pointBorderWidth: 2,
      }],
    },
    options: {
      ...baseOptions,
      scales: {
        x: { grid: { color: '#F1F5F9' }, ticks: { color: '#94A3B8', font: { size: 11 } } },
        y: {
          grid: { color: '#F1F5F9' }, ticks: {
            color: '#94A3B8', font: { size: 11 },
            callback: v => yPrefix + v.toLocaleString('en-IN'),
          },
        },
      },
    },
  });
};

SSCharts.bar = function(ctx, labels, data, { color = 'blue', label = 'Value', yPrefix = '' } = {}) {
  if (!ctx || typeof Chart === 'undefined') return null;
  destroyIfExists(ctx);
  const c = PALETTE[color] || PALETTE.blue;
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label, data,
        backgroundColor: c.bg.replace('0.12', '0.7'),
        borderColor: c.border, borderWidth: 1.5,
        borderRadius: 6, borderSkipped: false,
      }],
    },
    options: {
      ...baseOptions,
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94A3B8', font: { size: 11 } } },
        y: {
          grid: { color: '#F1F5F9' }, ticks: {
            color: '#94A3B8', font: { size: 11 },
            callback: v => yPrefix + v.toLocaleString('en-IN'),
          },
        },
      },
    },
  });
};

SSCharts.doughnut = function(ctx, labels, data, { colors = MULTI, cutout = '65%' } = {}) {
  if (!ctx || typeof Chart === 'undefined') return null;
  destroyIfExists(ctx);
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: colors.slice(0, data.length),
        borderWidth: 2, borderColor: '#fff',
        hoverOffset: 6,
      }],
    },
    options: {
      ...baseOptions,
      cutout,
      plugins: {
        ...baseOptions.plugins,
        legend: { position: 'bottom', ...baseOptions.plugins.legend },
      },
    },
  });
};

SSCharts.multiLine = function(ctx, labels, datasets, { yPrefix = '' } = {}) {
  if (!ctx || typeof Chart === 'undefined') return null;
  destroyIfExists(ctx);
  const colorKeys = Object.keys(PALETTE);
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, i) => {
        const c = PALETTE[colorKeys[i % colorKeys.length]];
        return {
          label: ds.label, data: ds.data,
          borderColor: c.border, backgroundColor: 'transparent',
          tension: 0.4, pointRadius: 3, pointBackgroundColor: c.border,
          ...ds,
        };
      }),
    },
    options: {
      ...baseOptions,
      scales: {
        x: { grid: { color: '#F1F5F9' }, ticks: { color: '#94A3B8', font: { size: 11 } } },
        y: {
          grid: { color: '#F1F5F9' }, ticks: {
            color: '#94A3B8', font: { size: 11 },
            callback: v => yPrefix + v.toLocaleString('en-IN'),
          },
        },
      },
    },
  });
};

function initAutoCharts() {
  document.querySelectorAll('[data-chart]').forEach(el => {
    const type    = el.dataset.chart;
    const labels  = JSON.parse(el.dataset.labels || '[]');
    const data    = JSON.parse(el.dataset.data   || '[]');
    const color   = el.dataset.color   || 'blue';
    const label   = el.dataset.label   || 'Value';
    const prefix  = el.dataset.prefix  || '';
    if (SSCharts[type]) SSCharts[type](el, labels, data, { color, label, yPrefix: prefix });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAutoCharts);
} else {
  initAutoCharts();
}