import { API_BASE } from './utils/api.js';

let currentUser = null;

export async function initAuth() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
    }
  } catch {
    // backend not reachable — stay logged out
  }
  renderAuthHeader();
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export function requireAuth(redirectTo = 'login.html') {
  if (!currentUser) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

function renderAuthHeader() {
  const section = document.querySelector('.js-auth-section');
  if (!section) return;

  if (currentUser) {
    section.innerHTML = `
      <a class="auth-user-name" href="settings.html" title="${currentUser.name}">
        Hi, ${currentUser.name.split(' ')[0]}
      </a>
      <button class="auth-btn auth-btn-signout js-sign-out">Sign out</button>
    `;
    section.querySelector('.js-sign-out').addEventListener('click', async () => {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      window.location.href = 'login.html';
    });
  } else {
    section.innerHTML = `
      <a class="auth-btn auth-btn-signin" href="login.html">Sign in</a>
    `;
  }
}

// Keep cart count badge in sync across all pages
export function updateCartBadge(count) {
  document.querySelectorAll('.js-cart-quantity').forEach(el => {
    el.textContent = count;
  });
}
