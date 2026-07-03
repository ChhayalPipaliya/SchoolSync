function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validatePhone(phone) { 
  const cleaned = (phone || '').replace(/\D/g, "");
  return /^[1-9]\d{9}$/.test(cleaned) || /^\d{10}$/.test(cleaned); 
}
function validatePassword(password) { return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password); }
function validateRequired(value) { return value && value.trim().length > 0; }
function validateMinLength(value, min) { return (value || '').trim().length >= min; }
function validateMaxLength(value, max) { return (value || '').trim().length <= max; }
function validateNumber(value, min, max) { const num = Number(value); return !isNaN(num) && num >= min && num <= max; }
function validateDate(value) { return !isNaN(new Date(value).getTime()); }
function validateNotFuture(value) { return new Date(value) <= new Date(); }
function validateAge(dob, min, max) {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= min && age <= max;
}
function validateAadhaar(value) { return /^\d{12}$/.test(value); }
function validatePAN(value) { return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase()); }

function initFormValidation(form) {
  if (!form) return;
  form.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('blur', () => validateField(field));
    field.addEventListener('input', () => clearFieldError(field));
  });
  form.addEventListener('submit', (e) => {
    let valid = true;
    form.querySelectorAll('input, select, textarea').forEach(field => {
      if (!validateField(field)) valid = false;
    });
    if (!valid) e.preventDefault();
  });
}
function validateField(field) {
  const rules = field.dataset.validate?.split('|') || [];
  let error = '';
  for (const rule of rules) {
    if (rule === 'required' && !validateRequired(field.value)) { error = 'This field is required'; break; }
    if (rule === 'email' && !validateEmail(field.value)) { error = 'Please enter a valid email'; break; }
    if (rule === 'phone' && !validatePhone(field.value)) { error = 'Please enter a valid 10-digit phone'; break; }
    if (rule.startsWith('min:')) { const min = parseInt(rule.split(':')[1]); if (!validateMinLength(field.value, min)) { error = `Minimum ${min} characters required`; break; } }
    if (rule.startsWith('max:')) { const max = parseInt(rule.split(':')[1]); if (!validateMaxLength(field.value, max)) { error = `Maximum ${max} characters allowed`; break; } }
  }
  if (error) showFieldError(field, error);
  return !error;
}
function showFieldError(field, message) {
  clearFieldError(field);
  const errorDiv = document.createElement('div');
  errorDiv.className = 'form-error';
  errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
  field.parentNode.appendChild(errorDiv);
  field.style.borderColor = 'var(--danger)';
}
function clearFieldError(field) {
  field.style.borderColor = '';
  const error = field.parentNode.querySelector('.form-error');
  if (error) error.remove();
}
