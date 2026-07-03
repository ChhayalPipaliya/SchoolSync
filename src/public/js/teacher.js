document.addEventListener('DOMContentLoaded', () => {
  initAttendanceMark();
  initMarksEntry();
  initHomeworkCreate();
  initAttendanceChart();
});

function destroyChartIfExists(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (canvas && typeof Chart !== 'undefined') {
    const existing = Chart.getChart(canvas);
    if (existing) {
      existing.destroy();
    }
  }
}

function initAttendanceMark() {
  document.querySelectorAll('.attendance-student').forEach(student => {
    student.addEventListener('click', function() {
      const isPresent = this.classList.toggle('present');
      this.classList.toggle('absent', !isPresent);
      const input = this.querySelector('input');
      if (input) input.value = isPresent ? 'present' : 'absent';
    });
  });
}

function initMarksEntry() {
  document.querySelectorAll('.marks-input').forEach(input => {
    input.addEventListener('change', () => {
      const max = parseFloat(input.dataset.max) || 100;
      const val = parseFloat(input.value) || 0;
      if (val > max) {
        input.value = max;
        if (window.showToast) showToast(`Maximum marks is ${max}`, 'warning');
      }
    });
  });
}

function initHomeworkCreate() {
  // Homework form handling
}

function initAttendanceChart() {
  const ctx = document.getElementById('attendanceChart');
  if (!ctx || typeof Chart === 'undefined') return;

  destroyChartIfExists('attendanceChart');

  try {
    const labels = JSON.parse(ctx.dataset.labels || '[]');
    const presentData = JSON.parse(ctx.dataset.present || '[]');
    const absentData = JSON.parse(ctx.dataset.absent || '[]');

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Present',
            data: presentData,
            backgroundColor: '#10B981',
            borderRadius: 4
          },
          {
            label: 'Absent',
            data: absentData,
            backgroundColor: '#EF4444',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: "'Inter', sans-serif", size: 11 } }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 10,
            cornerRadius: 6
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { 
            beginAtZero: true,
            grid: { color: '#F1F5F9' },
            ticks: { precision: 0 }
          }
        }
      }
    });
  } catch (e) {
    console.error('Attendance chart error:', e);
  }
}
