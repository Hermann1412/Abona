import { loadCart, getCartQuantity } from '../data/cart.js';
import { initAuth, requireAuth } from './auth.js';
import { renderOrderSummary } from './checkout/orderSummary.js';
import { renderPaymentSummary } from './checkout/paymentSummary.js';

async function init() {
  const user = await initAuth();
  if (!requireAuth()) return;   // redirects to login.html if not logged in

  await loadCart();

  // Update item count in the header
  document.querySelector('.js-cart-count').textContent = getCartQuantity();

  renderOrderSummary();
  await renderPaymentSummary();
}

init();
