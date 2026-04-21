// Shared utilities loaded on every admin page

// ─── Auth guard ───────────────────────────────────────────────────────────────
// Called on every page except login.html
async function guardAdmin() {
  try {
    const res = await fetch('/admin/api/me', { credentials: 'include' });
    if (!res.ok) {
      window.location.href = '/admin/login';
      return null;
    }
    const { admin } = await res.json();
    document.querySelector('.admin-name').textContent  = admin.name;
    document.querySelector('.admin-email').textContent = admin.email;
    return admin;
  } catch {
    window.location.href = '/admin/login';
    return null;
  }
}

// ─── Active nav link ──────────────────────────────────────────────────────────
function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  await fetch('/admin/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/admin/login';
}

// ─── Toast notification ───────────────────────────────────────────────────────
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = ''; }, 3000);
}

// ─── Format currency ─────────────────────────────────────────────────────────
function formatCurrency(cents) {
  return '฿' + (cents / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

// ─── Format date ─────────────────────────────────────────────────────────────
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function statusBadge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

// ─── Copy full ID to clipboard ────────────────────────────────────────────────
function copyId(el, fullId) {
  navigator.clipboard.writeText(fullId).then(() => {
    const orig = el.textContent;
    el.textContent = '✓ Copied!';
    el.style.color = '#16a34a';
    el.style.borderBottomColor = '#16a34a';
    setTimeout(() => {
      el.textContent = orig;
      el.style.color = '';
      el.style.borderBottomColor = '';
    }, 1500);
  }).catch(() => {
    const inp = document.createElement('input');
    inp.value = fullId;
    document.body.appendChild(inp);
    inp.select();
    document.execCommand('copy');
    document.body.removeChild(inp);
    showToast('ID copied');
  });
}

// Bind logout button once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.logout-btn')?.addEventListener('click', logout);
  setActiveNav();
});
