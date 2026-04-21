import { API_BASE } from '../scripts/utils/api.js';

export let cart = [];

export async function loadCart() {
  try {
    const res = await fetch(`${API_BASE}/api/cart`, { credentials: 'include' });
    if (!res.ok) { cart = []; return; }
    const items = await res.json();
    cart = items.map(item => ({
      productId: item.product_id,
      quantity: item.quantity,
      deliveryOptionId: item.delivery_option_id,
      priceCents: item.price_cents,
      name: item.name,
      image: item.image
    }));
  } catch {
    cart = [];
  }
}

export async function addToCart(productId, quantity = 1) {
  const res = await fetch(`${API_BASE}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ productId, quantity })
  });

  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }

  const existing = cart.find(i => i.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({ productId, quantity, deliveryOptionId: '1' });
  }
}

export async function removeFromCart(productId) {
  await fetch(`${API_BASE}/api/cart/${productId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  cart = cart.filter(i => i.productId !== productId);
}

export async function updateDeliveryOption(productId, deliveryOptionId) {
  await fetch(`${API_BASE}/api/cart/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deliveryOptionId })
  });
  const item = cart.find(i => i.productId === productId);
  if (item) item.deliveryOptionId = deliveryOptionId;
}

export async function updateQuantity(productId, quantity) {
  await fetch(`${API_BASE}/api/cart/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ quantity })
  });
  if (quantity <= 0) {
    cart = cart.filter(i => i.productId !== productId);
  } else {
    const item = cart.find(i => i.productId === productId);
    if (item) item.quantity = quantity;
  }
}

export function getCartQuantity() {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}
