window.SchoolSync = window.SchoolSync || {};

function showToast(message, type = 'success', duration = 3000) {
  const container = document.querySelector('.toast-container') || createToastContainer();
  const toast = document.createElement('div');
  const colors = {
    success: 'background:#D1FAE5;color:#065F46;border:1px solid #A7F3D0;',
    error: 'background:#FEE2E2;color:#991B1B;border:1px solid #FECACA;',
    warning: 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;'
  };
  const icons = { success: '✓', error: '✕', warning: '⚠' };

  toast.style.cssText = `${colors[type] || colors.success}padding:14px 20px;border-radius:12px;font-size:14px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);animation:slideIn 0.3s ease;min-width:300px;margin-bottom:10px;`;
  toast.innerHTML = `<span style="font-size:18px;">${icons[type] || icons.success}</span>${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;';
  document.body.appendChild(container);
  return container;
}

function confirmAction(message, callback) {
  if (confirm(message)) callback();
}

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ajax(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  }).then(r => r.json());
}

SchoolSync.showToast = showToast;
SchoolSync.toast = showToast;
SchoolSync.confirmAction = confirmAction;
SchoolSync.formatCurrency = formatCurrency;
SchoolSync.formatDate = formatDate;
SchoolSync.ajax = ajax;
SchoolSync.$ = (selector, ctx = document) => ctx.querySelector(selector);
SchoolSync.$$ = (selector, ctx = document) => Array.from(ctx.querySelectorAll(selector));

const animStyle = document.createElement('style');
animStyle.textContent = `@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`;
document.head.appendChild(animStyle);

// Light-only theme guard. Kept as a compatibility shim for legacy pages.
window.initTheme = function() {
  document.documentElement.classList.remove('dark');
  document.body.classList.remove('dark');
};

document.addEventListener('DOMContentLoaded', window.initTheme);
