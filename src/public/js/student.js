function destroyChartIfExists(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (canvas && typeof Chart !== 'undefined') {
        const existing = Chart.getChart(canvas);
        if (existing) {
            existing.destroy();
        };
    };
};

function initRevealAnimations() {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;

    if (!('IntersectionObserver' in window)) {
        reveals.forEach(el => el.classList.add('visible'));
        return;
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            };
        });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

    reveals.forEach(el => observer.observe(el));
};

function initCurrentDate() {
    const el = document.getElementById('currentDate');
    if (el) {
        const now = new Date();
        el.textContent = now.toLocaleDateString('en-IN', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    };
};

function animateCounters() {
    document.querySelectorAll('.stat-value[data-target]').forEach(counter => {
        const target = parseFloat(counter.dataset.target) || 0;
        if (target === 0) return;

        const isDecimal = counter.dataset.decimal === 'true';
        const suffix = counter.dataset.suffix || '';
        const prefix = counter.textContent.includes('₹') ? '₹' : '';
        let current = 0;
        const increment = target / 40;

        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            };

            let formatted;
            if (isDecimal) {
                formatted = current.toFixed(1);
            } else {
                formatted = Math.floor(current).toLocaleString('en-IN');
            };

            counter.textContent = prefix + formatted + suffix;
        }, 25);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    initCurrentDate();
    initRevealAnimations();
    animateCounters();
    initHomeworkSubmit();
    initResultChart();
    initTimetable();
});

function initHomeworkSubmit() {
    document.querySelectorAll('.homework-submit-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const hwId = this.dataset.homeworkId;
        });
    });
};

function initResultChart() {
    const ctx = document.getElementById('resultChart');
    if (!ctx || typeof Chart === 'undefined') return;

    destroyChartIfExists('resultChart');

    try {
        const labels = JSON.parse(ctx.dataset.labels || '[]');
        const data = JSON.parse(ctx.dataset.data || '[]');
        const outOf = JSON.parse(ctx.dataset.outof || '[]');

        const chartData = outOf.length > 0
            ? data.map((mark, i) => outOf[i] ? Math.round((mark / outOf[i]) * 100) : mark)
            : data;

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: outOf.length > 0 ? 'Score %' : 'Marks',
                    data: chartData,
                    backgroundColor: outOf.length > 0
                        ? chartData.map(pct => pct >= 75 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626')
                        : '#7C3AED',
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0F172A',
                        titleColor: '#F8FAFC',
                        bodyColor: '#CBD5E1',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function (context) {
                                const idx = context.dataIndex;
                                if (outOf.length > 0 && data[idx] !== undefined && outOf[idx]) {
                                    return `${data[idx]} / ${outOf[idx]} marks (${context.raw}%)`;
                                }
                                return context.raw + ' marks';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94A3B8', font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        max: outOf.length > 0 ? 100 : undefined,
                        grid: { color: '#F1F5F9' },
                        ticks: {
                            color: '#94A3B8',
                            font: { size: 11 },
                            callback: v => outOf.length > 0 ? v + '%' : v
                        }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Result chart error:', e);
    };
}

function initTimetable() {}