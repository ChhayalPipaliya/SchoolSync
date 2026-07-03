/* ============================================================
   librarian.js — Library management JS
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initCurrentDate();
  initStatCounters();
  initBookSearch();
  initMemberSearch();
  initIssuedBooksChart();
  initCategoryFilter();
  initBarcodeScanner();
});

/* ── Current date ── */
function initCurrentDate() {
  const el = document.getElementById('currentDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/* ── Stat counters ── */
function initStatCounters() {
  document.querySelectorAll('.stat-info h3[data-target], .counter[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target) || 0;
    if (!target) return;
    const start = performance.now(), dur = 1100;
    el.textContent = '0';
    (function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString('en-IN');
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  });
}

/* ── Book search ── */
function initBookSearch() {
  const input = document.getElementById('bookSearch');
  if (!input) return;
  let debounceTimer;
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const q = this.value.toLowerCase().trim();
    debounceTimer = setTimeout(() => {
      document.querySelectorAll('[data-book-row]').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
      const count = document.getElementById('bookCount');
      if (count) {
        const visible = document.querySelectorAll('[data-book-row]:not([style*="none"])').length;
        count.textContent = visible + ' book' + (visible !== 1 ? 's' : '');
      }
    }, 200);
  });
}

/* ── Member search ── */
function initMemberSearch() {
  const input = document.getElementById('memberSearch');
  if (!input) return;
  input.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll('[data-member-row]').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

/* ── Issued books chart ── */
function initIssuedBooksChart() {
  const ctx = document.getElementById('issuedBooksChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const labels = JSON.parse(ctx.dataset.labels || '[]');
  const data   = JSON.parse(ctx.dataset.data   || '[]');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Books Issued',
        data,
        borderColor: '#DB2777',
        backgroundColor: 'rgba(219,39,119,0.1)',
        fill: true, tension: 0.4,
        pointRadius: 4, pointBackgroundColor: '#DB2777',
        pointBorderColor: '#fff', pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94A3B8', font: { size: 11 } } },
        y: { grid: { color: '#F1F5F9' }, ticks: { color: '#94A3B8', font: { size: 11 }, stepSize: 1 } },
      },
    },
  });
}

/* ── Category filter pills ── */
function initCategoryFilter() {
  document.querySelectorAll('.category-pill[data-category]').forEach(pill => {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      const cat = this.dataset.category;
      document.querySelectorAll('[data-book-row][data-category]').forEach(row => {
        row.style.display = (cat === 'all' || row.dataset.category === cat) ? '' : 'none';
      });
    });
  });
}

/* ── Barcode / ISBN quick lookup ── */
function initBarcodeScanner() {
  const input = document.getElementById('isbnInput');
  if (!input) return;
  let buffer = '', timer;
  document.addEventListener('keydown', function (e) {
    if (document.activeElement.tagName === 'INPUT' && document.activeElement !== input) return;
    clearTimeout(timer);
    if (e.key === 'Enter' && buffer.length > 5) {
      lookupISBN(buffer);
      buffer = '';
      return;
    }
    if (e.key.length === 1) buffer += e.key;
    timer = setTimeout(() => { buffer = ''; }, 400);
  });
}

function lookupISBN(isbn) {
  const input = document.getElementById('isbnInput');
  if (input) input.value = isbn;
  window.showToast?.('ISBN captured. Complete book details before saving.', 'success');
}

function populateBookForm(book) {
  const fields = { 'book-title': book.title, 'book-author': book.author, 'book-isbn': book.isbn };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  });
}

/* ── Issue book ── */
window.issueBook = function(bookId, memberId) {
  if (!bookId || !memberId) {
    window.showToast?.('Select both book and member', 'warning');
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/librarian/issues/new';
  Object.entries({ book_id: bookId, user_id: memberId }).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
};

/* ── Return book ── */
window.returnBook = function(issueId) {
  if (!window.confirmAction) {
    if (!confirm('Mark this book as returned?')) return;
    window.location.href = `/librarian/issues/${issueId}/return`;
    return;
  }
  confirmAction('Mark this book as returned and calculate any fine?', () => {
    window.location.href = `/librarian/issues/${issueId}/return`;
  }, { title: 'Return Book', confirmText: 'Confirm Return' });
};

/* ── Delete book ── */
window.deleteBook = function(id) {
  if (!window.confirmAction) {
    if (!confirm('Delete this book record?')) return;
    submitPost(`/librarian/books/${id}/delete`);
    return;
  }
  confirmAction('This will permanently remove the book record.', () => {
    submitPost(`/librarian/books/${id}/delete`);
  }, { title: 'Delete Book', confirmText: 'Delete', danger: true });
};

/* ── Print library card ── */
window.printLibraryCard = function(memberId) {
  window.showToast?.('Library card printing is not enabled yet.', 'warning');
  if (memberId) window.location.href = '/librarian/members';
};

function submitPost(action) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  document.body.appendChild(form);
  form.submit();
}
