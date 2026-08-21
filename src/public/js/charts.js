window.SSCharts = {};

const PALETTE = {
    blue: { border: '#2563EB', bg: 'rgba(37,99,235,0.12)' },
    green: { border: '#059669', bg: 'rgba(5,150,105,0.12)' },
    purple: { border: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
    orange: { border: '#EA580C', bg: 'rgba(234,88,12,0.12)' },
    pink: { border: '#DB2777', bg: 'rgba(219,39,119,0.12)' },
    indigo: { border: '#4F46E5', bg: 'rgba(79,70,229,0.12)' },
    amber: { border: '#D97706', bg: 'rgba(217,119,6,0.12)' },
};
const MULTI = ['#2563EB', '#059669', '#7C3AED', '#EA580C', '#DB2777', '#4F46E5', '#D97706', '#DC2626'];

function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' || document.documentElement.classList.contains('dark');
}

function getThemeColors() {
    const dark = isDarkTheme();
    return {
        grid: dark ? 'rgba(51, 65, 85, 0.45)' : '#F1F5F9',
        ticks: dark ? '#94A3B8' : '#64748B',
        legend: dark ? '#CBD5E1' : '#64748B',
        tooltipBg: dark ? '#1E293B' : '#0F172A',
        tooltipTitle: dark ? '#F8FAFC' : '#F8FAFC',
        tooltipBody: dark ? '#CBD5E1' : '#CBD5E1',
        doughnutBorder: dark ? '#151D30' : '#FFFFFF',
    };
}

function getBaseOptions() {
    const colors = getThemeColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { font: { family: "'Inter',sans-serif", size: 12 }, color: colors.legend, boxWidth: 12, padding: 16 } },
            tooltip: {
                backgroundColor: colors.tooltipBg,
                titleColor: colors.tooltipTitle,
                bodyColor: colors.tooltipBody,
                padding: 12,
                cornerRadius: 8,
                titleFont: { weight: '600' },
            },
        },
    };
}

function destroyIfExists(ctx) {
    if (!ctx || typeof Chart === 'undefined') return;
    const canvas = ctx instanceof HTMLCanvasElement ? ctx : ctx.canvas;
    if (canvas) {
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
    }
}

SSCharts.line = function (ctx, labels, data, { color = 'blue', label = 'Value', yPrefix = '' } = {}) {
    if (!ctx || typeof Chart === 'undefined') return null;
    destroyIfExists(ctx);
    const c = PALETTE[color] || PALETTE.blue;
    const themeColors = getThemeColors();
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label, data,
                borderColor: c.border, backgroundColor: c.bg,
                fill: true, tension: 0.4, pointRadius: 4,
                pointBackgroundColor: c.border, pointBorderColor: themeColors.doughnutBorder, pointBorderWidth: 2,
            }],
        },
        options: {
            ...getBaseOptions(),
            scales: {
                x: { grid: { color: themeColors.grid }, ticks: { color: themeColors.ticks, font: { size: 11 } } },
                y: {
                    grid: { color: themeColors.grid }, ticks: {
                        color: themeColors.ticks, font: { size: 11 },
                        callback: v => yPrefix + v.toLocaleString('en-IN'),
                    },
                },
            },
        },
    });
};

SSCharts.bar = function (ctx, labels, data, { color = 'blue', label = 'Value', yPrefix = '' } = {}) {
    if (!ctx || typeof Chart === 'undefined') return null;
    destroyIfExists(ctx);
    const c = PALETTE[color] || PALETTE.blue;
    const themeColors = getThemeColors();
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
            ...getBaseOptions(),
            scales: {
                x: { grid: { display: false }, ticks: { color: themeColors.ticks, font: { size: 11 } } },
                y: {
                    grid: { color: themeColors.grid }, ticks: {
                        color: themeColors.ticks, font: { size: 11 },
                        callback: v => yPrefix + v.toLocaleString('en-IN'),
                    },
                },
            },
        },
    });
};

SSCharts.doughnut = function (ctx, labels, data, { colors = MULTI, cutout = '65%' } = {}) {
    if (!ctx || typeof Chart === 'undefined') return null;
    destroyIfExists(ctx);
    const base = getBaseOptions();
    const themeColors = getThemeColors();
    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data, backgroundColor: colors.slice(0, data.length),
                borderWidth: 2, borderColor: themeColors.doughnutBorder,
                hoverOffset: 6,
            }],
        },
        options: {
            ...base,
            cutout,
            plugins: {
                ...base.plugins,
                legend: { position: 'bottom', ...base.plugins.legend },
            },
        },
    });
};

SSCharts.multiLine = function (ctx, labels, datasets, { yPrefix = '' } = {}) {
    if (!ctx || typeof Chart === 'undefined') return null;
    destroyIfExists(ctx);
    const colorKeys = Object.keys(PALETTE);
    const themeColors = getThemeColors();
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
            ...getBaseOptions(),
            scales: {
                x: { grid: { color: themeColors.grid }, ticks: { color: themeColors.ticks, font: { size: 11 } } },
                y: {
                    grid: { color: themeColors.grid }, ticks: {
                        color: themeColors.ticks, font: { size: 11 },
                        callback: v => yPrefix + v.toLocaleString('en-IN'),
                    },
                },
            },
        },
    });
};

function initAutoCharts() {
    document.querySelectorAll('[data-chart]').forEach(el => {
        const type = el.dataset.chart;
        const labels = JSON.parse(el.dataset.labels || '[]');
        const data = JSON.parse(el.dataset.data || '[]');
        const color = el.dataset.color || 'blue';
        const label = el.dataset.label || 'Value';
        const prefix = el.dataset.prefix || '';
        if (SSCharts[type]) SSCharts[type](el, labels, data, { color, label, yPrefix: prefix });
    });
}

window.addEventListener('themeChanged', () => {
    if (typeof Chart === 'undefined') return;
    const colors = getThemeColors();

    if (Chart.instances) {
        Object.values(Chart.instances).forEach(chart => {
            if (chart.options.scales) {
                if (chart.options.scales.x && chart.options.scales.x.grid) {
                    chart.options.scales.x.grid.color = colors.grid;
                }
                if (chart.options.scales.x && chart.options.scales.x.ticks) {
                    chart.options.scales.x.ticks.color = colors.ticks;
                }
                if (chart.options.scales.y && chart.options.scales.y.grid) {
                    chart.options.scales.y.grid.color = colors.grid;
                }
                if (chart.options.scales.y && chart.options.scales.y.ticks) {
                    chart.options.scales.y.ticks.color = colors.ticks;
                }
            }
            if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                chart.options.plugins.legend.labels.color = colors.legend;
            }
            if (chart.options.plugins && chart.options.plugins.tooltip) {
                chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
                chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
                chart.options.plugins.tooltip.bodyColor = colors.tooltipBody;
            }
            chart.data.datasets.forEach(ds => {
                if (ds.borderColor === '#fff' || ds.borderColor === '#151D30') {
                    ds.borderColor = colors.doughnutBorder;
                }
            });
            chart.update();
        });
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoCharts);
} else {
    initAutoCharts();
}