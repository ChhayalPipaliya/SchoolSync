let revenueChartInstance = null;
let planChartInstance = null;
let activeLeaderboardTab = 'revenue';

document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    };
    initTheme();
    renderLeaderboard();
    renderCharts();
    animateInitialCounters();
    initDashboardSocket();
});

function initTheme() {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    updateChartsTheme();
};

function updateChartsTheme() {
    const textColor = '#64748B';
    const gridColor = '#E2E8F0';

    if (revenueChartInstance) {
        revenueChartInstance.options.scales.x.ticks.color = textColor;
        revenueChartInstance.options.scales.y.ticks.color = textColor;
        revenueChartInstance.options.scales.y.grid.color = gridColor;
        revenueChartInstance.update();
    };

    if (planChartInstance) {
        planChartInstance.options.plugins.legend.labels.color = textColor;
        planChartInstance.update();
    };
};

function renderCharts() {
    renderRevenueTrendChart();
    renderPlanDistributionChart();
};

function renderRevenueTrendChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    const labels = JSON.parse(canvas.dataset.labels || '[]');
    const data = JSON.parse(canvas.dataset.data || '[]');

    if (revenueChartInstance) {
        revenueChartInstance.destroy();
    };

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#E2E8F0';
    const textColor = isDark ? '#94A3B8' : '#64748B';
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.22)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');

    revenueChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue (INR)',
                data: data,
                borderColor: '#2563EB',
                backgroundColor: gradient,
                borderWidth: 2.5,
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#2563EB',
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1E293B' : '#fff',
                    titleColor: isDark ? '#F8FAFC' : '#0F172A',
                    bodyColor: isDark ? '#F8FAFC' : '#0F172A',
                    borderColor: isDark ? '#334155' : '#E2E8F0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => `₹${context.parsed.y.toLocaleString('en-IN')}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: "'Outfit', sans-serif", size: 10 } }
                },
                y: {
                    grid: { color: gridColor, borderDash: [4, 4] },
                    ticks: {
                        color: textColor,
                        font: { family: "'Outfit', sans-serif", size: 10 },
                        callback: (v) => `₹${v / 1000}k`
                    }
                }
            }
        }
    });
};

function renderPlanDistributionChart() {
    const canvas = document.getElementById('planChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = JSON.parse(canvas.dataset.labels || '[]');
    const data = JSON.parse(canvas.dataset.data || '[]');
    const colors = JSON.parse(canvas.dataset.colors || '[]');

    if (planChartInstance) {
        planChartInstance.destroy();
    };

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94A3B8' : '#64748B';

    planChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: isDark ? '#1E293B' : '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1E293B' : '#fff',
                    titleColor: isDark ? '#F8FAFC' : '#0F172A',
                    bodyColor: isDark ? '#F8FAFC' : '#0F172A',
                    borderColor: isDark ? '#334155' : '#E2E8F0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 12,
                    callbacks: {
                        label: (context) => ` ₹${context.raw.toLocaleString('en-IN')}`
                    }
                }
            }
        }
    });
};

function switchLeaderboardTab(tabName) {
    activeLeaderboardTab = tabName;

    const tabs = ['revenue', 'recent', 'expiring', 'risk'];
    tabs.forEach(t => {
        const btn = document.getElementById(`btn-tab-${t}`);
        if (btn) {
            if (t === tabName) {
                btn.className = "px-3 py-1.5 rounded-lg text-xs font-bold border-0 cursor-pointer bg-blue-50 text-blue-600 flex items-center gap-1.5 transition-all";
            } else {
                btn.className = "px-3 py-1.5 rounded-lg text-xs font-bold border-0 cursor-pointer bg-transparent text-slate-500 hover:bg-slate-100 flex items-center gap-1.5 transition-all";
            };
        };
    });

    renderLeaderboard();
};

function renderLeaderboard() {
    const container = document.getElementById('leaderboard-tbody');
    const dataEl = document.getElementById('leaderboard-data');
    if (!container || !dataEl) return;

    const data = JSON.parse(dataEl.textContent);
    let list = [];

    if (activeLeaderboardTab === 'revenue') {
        list = data.topRevenue || [];
    } else if (activeLeaderboardTab === 'recent') {
        list = data.recentSignups || [];
    } else if (activeLeaderboardTab === 'expiring') {
        list = data.expiringSoon || [];
    } else if (activeLeaderboardTab === 'risk') {
        list = data.atRisk || [];
    };

    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-8 text-slate-400">
                    <i class="fas fa-school fa-2x mb-2 opacity-50"></i>
                    <p class="mb-0">No records found for this category.</p>
                </td>
            </tr>
        `;
        return;
    };

    list.forEach((school, index) => {
        const rank = index + 1;
        const planClass = `chip-plan-${(school.plan || 'basic').toLowerCase()}`;
        const statusClass = `chip-status-${(school.status || 'trial').toLowerCase()}`;
        const healthDotClass = school.health_score >= 90 ? 'bg-green-500' : school.health_score >= 75 ? 'bg-amber-500' : 'bg-red-500';

        const row = document.createElement('tr');
        row.className = 'border-b border-slate-100 hover:bg-slate-50/50 transition-all';
        row.innerHTML = `
            <td class="py-3.5 font-bold text-slate-400">#${rank}</td>
            <td class="py-3.5">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold font-display text-sm">
                        ${(school.name || 'S').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <span class="font-bold text-slate-800 block text-xs">${school.name}</span>
                        <span class="text-[10px] text-slate-400">Reg: ${new Date(school.created_at).toLocaleDateString('en-IN')}</span>
                  </div>
                </div>
            </td>
            <td class="py-3.5">
                <span class="chip ${planClass}">${school.plan || 'Basic'}</span>
            </td>
            <td class="py-3.5 text-center font-semibold text-slate-700">${school.students || 0}</td>
            <td class="py-3.5 text-center font-semibold text-slate-700">${school.teachers || 0}</td>
            <td class="py-3.5 font-bold text-slate-900">₹${parseFloat(school.revenue).toLocaleString('en-IN')}</td>
            <td class="py-3.5">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full ${healthDotClass} inline-block animate-pulse-slow"></span>
                    <span class="font-bold text-slate-800">${school.health_score}%</span>
                </div>
            </td>
            <td class="py-3.5">
                <span class="chip ${statusClass}">${school.status}</span>
            </td>
            <td class="py-3.5 text-right">
                <a href="/superadmin/schools/${school.id}" class="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold transition-all text-[11px] no-underline">View <i class="fas fa-arrow-right text-[9px]"></i></a>
            </td>
        `;
        container.appendChild(row);
    });
};

function initDashboardSocket() {
    if (typeof io === 'undefined') {
        initPollingFallback();
        return;
    };

    const socket = io();
    socket.on('connect', () => {
        // console.log('[Socket] Connected to server.');
    });

    socket.on('dashboard:kpi-update', (data) => {
        if (data.mrr) animateNumber('kpi-mrr', data.mrr, '₹');
        if (data.schools) animateNumber('kpi-active-schools', data.schools);
        if (data.tickets) animateNumber('kpi-open-tickets', data.tickets);
        if (data.health) animateNumber('kpi-platform-health', data.health, '', '%');
    });

    socket.on('dashboard:health-update', (data) => {
        updateHealthRing(data.score);
        updateHealthComponents(data.components);
    });
}

function initPollingFallback() {
    setInterval(() => {
        fetch('/superadmin/api/stats')
            .then(r => r.json())
            .then(res => {
                if (res.success && res.data) {
                    const metrics = res.data.metrics;
                    const health = res.data.health;

                    animateNumber('kpi-mrr', metrics.revenue.mrr, '₹');
                    animateNumber('kpi-active-schools', metrics.schools.active);
                    animateNumber('kpi-open-tickets', metrics.tickets.total);
                    animateNumber('kpi-platform-health', health.score, '', '%');

                    updateHealthRing(health.score);
                    updateHealthComponents(health.components);
                };
            })
            .catch(err => console.error('[Polling] Error fetching stats fallback:', err));
    }, 30000);
};

function animateNumber(elementId, target, prefix = '', suffix = '', duration = 1200) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const start = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(start + (target - start) * easeOut);

        el.textContent = prefix + current.toLocaleString('en-IN') + suffix;

        if (progress < 1) {
            requestAnimationFrame(update);
        };
    };
    requestAnimationFrame(update);
};

function animateInitialCounters() {
    const mrrVal = document.getElementById('mrr-value');
    if (mrrVal) {
        const cleanValue = parseInt(mrrVal.textContent.replace(/[^0-9]/g, '')) || 0;
        animateNumber('mrr-value', cleanValue, '₹');
    };

    const counters = [
        { id: 'kpi-active-schools', suffix: '' },
        { id: 'kpi-total-students', suffix: '' },
        { id: 'kpi-total-teachers', suffix: '' },
        { id: 'kpi-mrr', prefix: '₹', suffix: '' },
        { id: 'kpi-open-tickets', suffix: '' },
        { id: 'kpi-platform-health', suffix: '%' }
    ];

    counters.forEach(c => {
        const el = document.getElementById(c.id);
        if (el) {
            const cleanValue = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
            animateNumber(c.id, cleanValue, c.prefix || '', c.suffix || '');
        };
    });
};

function updateHealthRing(score) {
    const ring = document.getElementById('health-svg-ring');
    const text = document.getElementById('health-score-val');
    if (text) text.textContent = `${score}%`;

    if (ring) {
        const circumference = 339.292;
        const offset = circumference - (score / 100) * circumference;
        ring.style.strokeDashoffset = offset;

        const color = score >= 95 ? '#10B981' : score >= 80 ? '#F59E0B' : '#EF4444';
        ring.setAttribute('stroke', color);
    };
};

function updateHealthComponents(components) {
    const list = ['database', 'api', 'email', 'payments', 'backup', 'notifications'];
    list.forEach(item => {
        const comp = components[item];
        if (!comp) return;

        const dot = document.getElementById(`health-dot-${item}`);
        if (dot) {
            dot.className = `w-2.5 h-2.5 rounded-full ${comp.colorClass} mt-1.5 flex-shrink-0`;
        };

        const desc = document.getElementById(`health-desc-${item}`);
        if (desc) {
            desc.textContent = comp.detail;
        };
    });
};