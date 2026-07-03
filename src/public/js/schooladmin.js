function destroyChartIfExists(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (canvas && typeof Chart !== 'undefined') {
    const existing = Chart.getChart(canvas);
    if (existing) {
      existing.destroy();
    }
  }
}

function initRevealAnimations() {
  const reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  if (!('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

  reveals.forEach(el => observer.observe(el));
}

function initCurrentDate() {
  const el = document.getElementById('currentDate');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCurrentDate();
  initRevealAnimations();
  initFeeCalculator();
  initAttendanceCalendar();
  initIdCardPreview();
  initBulkActions();
  initDashboardCharts();
  animateCounters();
  initAttendanceRings();
  initGlobalSearch();
  initDragAndDrop();
});

function initFeeCalculator() {
  const amountInput = document.querySelector('[name="amount_paid"]');
  const totalDisplay = document.querySelector('.fee-total-display');
  if (!amountInput || !totalDisplay) return;

  amountInput.addEventListener('input', () => {
    const amount = parseFloat(amountInput.value) || 0;
    totalDisplay.textContent = `₹${amount.toLocaleString('en-IN')}`;
  });
}

function initAttendanceCalendar() {
  // Calendar view initialization
}

function initIdCardPreview() {
  const previewBtn = document.querySelector('.id-card-preview-btn');
  if (!previewBtn) return;

  previewBtn.addEventListener('click', () => {
  });
}

function initBulkActions() {
  const selectAll = document.querySelector('.select-all-checkbox');
  if (!selectAll) return;

  selectAll.addEventListener('change', () => {
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = selectAll.checked);
  });
}

function initDashboardCharts() {
  const feesCtx = document.getElementById('feesChart');
  if (feesCtx && typeof Chart !== 'undefined') {
    destroyChartIfExists('feesChart');

    try {
      const labels = JSON.parse(feesCtx.dataset.labels || '[]');
      const collected = JSON.parse(feesCtx.dataset.collected || '[]');
      const pending = JSON.parse(feesCtx.dataset.pending || '[]');

      new Chart(feesCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Collected',
              data: collected,
              backgroundColor: '#059669',
              borderColor: '#047857',
              borderWidth: 1,
              borderRadius: 6
            },
            {
              label: 'Pending',
              data: pending,
              backgroundColor: '#D97706',
              borderColor: '#B45309',
              borderWidth: 1,
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                font: { family: "'Inter', sans-serif", size: 12 }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return '₹' + value.toLocaleString('en-IN');
                }
              }
            }
          }
        }
      });
    } catch (e) {
      console.error('Fees chart error:', e);
    }
  }

  const attCtx = document.getElementById('attendanceTrendChart');
  if (attCtx && typeof Chart !== 'undefined') {
    destroyChartIfExists('attendanceTrendChart');

    try {
      const labels = JSON.parse(attCtx.dataset.labels || '[]');
      const data = JSON.parse(attCtx.dataset.data || '[]');

      new Chart(attCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Attendance %',
            data: data,
            borderColor: '#2563EB',
            backgroundColor: 'rgba(37,99,235,0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#2563EB',
            pointBorderColor: '#fff',
            pointBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                font: { family: "'Inter', sans-serif", size: 12 }
              }
            }
          },
          scales: {
            x: {
              grid: { color: '#F1F5F9' }
            },
            y: {
              beginAtZero: true,
              max: 100,
              ticks: {
                callback: function(value) {
                  return value + '%';
                }
              }
            }
          }
        }
      });
    } catch (e) {
      console.error('Attendance chart error:', e);
    }
  }
}

function animateCounters() {
  document.querySelectorAll('.counter').forEach(counter => {
    const target = parseFloat(counter.dataset.target || counter.textContent.replace(/[^0-9.]/g, '')) || 0;
    if (target === 0) return;

    let current = 0;
    const increment = target / 40;
    const isCurrency = counter.textContent.includes('₹') || counter.classList.contains('amount');

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        current = target;
        clearInterval(timer);
      }

      const formatted = Math.floor(current).toLocaleString('en-IN');
      counter.textContent = isCurrency ? '₹' + formatted : formatted;
    }, 25);
  });
}

function initAttendanceRings() {
  document.querySelectorAll('.ring-progress').forEach(ring => {
    const pct = parseFloat(ring.dataset.pct) || 0;
    const r = ring.r.baseVal.value;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (pct / 100) * circumference;

    ring.style.strokeDasharray = circumference;
    ring.style.strokeDashoffset = circumference;

    setTimeout(() => {
      ring.style.transition = 'stroke-dashoffset 1s ease-in-out';
      ring.style.strokeDashoffset = offset;
    }, 100);
  });
}

function initTheme() {
  document.documentElement.classList.remove("dark");
  document.body.classList.remove("dark");
}

function initGlobalSearch() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      focusSearch();
    }
  });
}

function focusSearch() {
  const input = document.getElementById('globalSearchInput');
  if (input) {
    input.focus();
    input.select();
  }
}

function initDragAndDrop() {
  const grid = document.querySelector('.bento-grid');
  if (!grid) return;
  
  const savedOrder = JSON.parse(localStorage.getItem('widget-order') || '[]');
  if (savedOrder.length > 0) {
    const cards = Array.from(grid.querySelectorAll('.kpi-card'));
    savedOrder.forEach(id => {
      const card = cards.find(c => c.dataset.widget === id);
      if (card) grid.appendChild(card);
    });
  }

  let dragSrcEl = null;

  grid.querySelectorAll('.kpi-card').forEach(card => {
    card.addEventListener('dragstart', function(e) {
      dragSrcEl = this;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', this.outerHTML);
      this.style.opacity = '0.4';
    });

    card.addEventListener('dragover', function(e) {
      if (e.preventDefault) e.preventDefault();
      return false;
    });

    card.addEventListener('drop', function(e) {
      if (e.stopPropagation) e.stopPropagation();
      if (dragSrcEl !== this) {
        const allCards = Array.from(grid.querySelectorAll('.kpi-card'));
        const srcIdx = allCards.indexOf(dragSrcEl);
        const destIdx = allCards.indexOf(this);
        
        if (srcIdx < destIdx) {
          this.parentNode.insertBefore(dragSrcEl, this.nextSibling);
        } else {
          this.parentNode.insertBefore(dragSrcEl, this);
        }

        const newOrder = Array.from(grid.querySelectorAll('.kpi-card')).map(c => c.dataset.widget);
        localStorage.setItem('widget-order', JSON.stringify(newOrder));
      }
      return false;
    });

    card.addEventListener('dragend', function() {
      this.style.opacity = '1';
      grid.querySelectorAll('.kpi-card').forEach(c => c.style.opacity = '1');
    });
  });
}

function showUpgradeDrawer() {
  const dr = document.getElementById('upgradeDrawer');
  if (dr) dr.classList.add('open');
}

function closeUpgradeDrawer() {
  const dr = document.getElementById('upgradeDrawer');
  if (dr) dr.classList.remove('open');
}
