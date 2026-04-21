import { cart } from '../../data/cart.js';
import { getDeliveryOption } from '../../data/deliveryOptions.js';
import { formatCurrency } from '../utils/money.js';
import { API_BASE } from '../utils/api.js';

let appliedCoupon = null; // { code, discountCents, description }

export async function renderPaymentSummary() {
  let productPriceCents  = 0;
  let shippingPriceCents = 0;

  cart.forEach(cartItem => {
    const priceCents = cartItem.priceCents || cartItem.price_cents || 0;
    productPriceCents += priceCents * cartItem.quantity;

    const option = getDeliveryOption(cartItem.deliveryOptionId);
    if (option) shippingPriceCents += option.priceCents;
  });

  const discountCents   = appliedCoupon?.discountCents || 0;
  const afterDiscount   = productPriceCents - discountCents;
  const totalBeforeTax  = afterDiscount + shippingPriceCents;
  const taxCents        = Math.round(totalBeforeTax * 0.07);
  const totalCents      = totalBeforeTax + taxCents;
  const itemCount       = cart.reduce((s, i) => s + i.quantity, 0);

  const discountRow = discountCents > 0 ? `
    <div class="payment-summary-row" style="color:#c40000">
      <div>Discount (${appliedCoupon.code}):</div>
      <div class="payment-summary-money">- ฿${formatCurrency(discountCents)}</div>
    </div>` : '';

  document.querySelector('.js-payment-summary').innerHTML = `
    <div class="payment-summary-title">Order Summary</div>

    <div class="payment-summary-row">
      <div>Items (${itemCount}):</div>
      <div class="payment-summary-money">฿${formatCurrency(productPriceCents)}</div>
    </div>

    <div class="payment-summary-row">
      <div>Shipping &amp; handling:</div>
      <div class="payment-summary-money">
        ${shippingPriceCents === 0 ? 'FREE' : '฿' + formatCurrency(shippingPriceCents)}
      </div>
    </div>

    ${discountRow}

    <div class="payment-summary-row subtotal-row">
      <div>Total before tax:</div>
      <div class="payment-summary-money">฿${formatCurrency(totalBeforeTax)}</div>
    </div>

    <div class="payment-summary-row">
      <div>VAT (7%):</div>
      <div class="payment-summary-money">฿${formatCurrency(taxCents)}</div>
    </div>

    <div class="payment-summary-row total-row">
      <div>Order total:</div>
      <div class="payment-summary-money">฿${formatCurrency(totalCents)}</div>
    </div>

    <!-- Coupon input -->
    <div class="coupon-section">
      <div class="coupon-row">
        <input type="text" id="coupon-input" class="coupon-input"
          placeholder="Coupon code"
          value="${appliedCoupon ? appliedCoupon.code : ''}">
        <button id="coupon-btn" class="coupon-btn">
          ${appliedCoupon ? 'Remove' : 'Apply'}
        </button>
      </div>
      <div id="coupon-msg" class="coupon-msg ${appliedCoupon ? 'coupon-success' : ''}">
        ${appliedCoupon ? `✓ ${appliedCoupon.description || appliedCoupon.code} applied` : ''}
      </div>
    </div>

    <div id="payment-element" style="margin-top:16px"></div>
    <div id="payment-error" style="color:#c40000;font-size:13px;margin-top:8px"></div>

    <button class="place-order-button button-primary js-place-order"
      ${cart.length === 0 ? 'disabled' : ''} style="margin-top:12px">
      Place your order
    </button>
  `;

  // Coupon button handler
  document.getElementById('coupon-btn').addEventListener('click', async () => {
    if (appliedCoupon) {
      appliedCoupon = null;
      renderPaymentSummary();
      return;
    }

    const code  = document.getElementById('coupon-input').value.trim();
    const msg   = document.getElementById('coupon-msg');
    const btn   = document.getElementById('coupon-btn');
    if (!code) return;

    btn.disabled = true;
    btn.textContent = '…';
    msg.className = 'coupon-msg';
    msg.textContent = '';

    try {
      const res = await fetch(`${API_BASE}/api/coupons/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, subtotalCents: productPriceCents })
      });
      const data = await res.json();

      if (!res.ok) {
        msg.className = 'coupon-msg coupon-error';
        msg.textContent = data.error;
        btn.disabled = false;
        btn.textContent = 'Apply';
        return;
      }

      appliedCoupon = {
        code: data.code,
        discountCents: data.discountCents,
        description: data.description
      };
      renderPaymentSummary();
    } catch {
      msg.className = 'coupon-msg coupon-error';
      msg.textContent = 'Network error.';
      btn.disabled = false;
      btn.textContent = 'Apply';
    }
  });

  // Allow pressing Enter on coupon input
  document.getElementById('coupon-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('coupon-btn').click();
  });

  if (cart.length === 0) return;

  await initStripe(totalCents);
}

async function initStripe(totalCents) {
  try {
    const cfgRes = await fetch(`${API_BASE}/api/config`);
    if (!cfgRes.ok) throw new Error('Config unavailable');
    const { stripePublishableKey } = await cfgRes.json();

    if (!stripePublishableKey || stripePublishableKey.startsWith('pk_test_your')) {
      showFallbackMessage();
      return;
    }

    const intentRes = await fetch(`${API_BASE}/api/payment/create-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amountCents: totalCents })
    });
    if (!intentRes.ok) throw new Error('Payment intent failed');
    const { clientSecret } = await intentRes.json();

    const stripe   = window.Stripe(stripePublishableKey);
    const elements = stripe.elements({ clientSecret });
    const payEl    = elements.create('payment');
    payEl.mount('#payment-element');

    document.querySelector('.js-place-order').addEventListener('click', async () => {
      const btn   = document.querySelector('.js-place-order');
      const errEl = document.getElementById('payment-error');
      btn.disabled = true;
      btn.textContent = 'Processing…';
      errEl.textContent = '';

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/orders.html` },
        redirect: 'if_required'
      });

      if (error) {
        errEl.textContent = error.message;
        btn.disabled = false;
        btn.textContent = 'Place your order';
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        const orderRes = await fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ couponCode: appliedCoupon?.code || null })
        });
        if (!orderRes.ok) {
          errEl.textContent = 'Payment succeeded but order save failed. Contact support.';
          btn.disabled = false;
          btn.textContent = 'Place your order';
          return;
        }
        const { orderId } = await orderRes.json();
        window.location.href = `orders.html?placed=${orderId}`;
      }
    });
  } catch (err) {
    console.error('Stripe init error:', err);
    showFallbackMessage();
  }
}

function showFallbackMessage() {
  const payEl = document.getElementById('payment-element');
  if (payEl) {
    payEl.innerHTML = `
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px;font-size:13px;color:#856404">
        ⚠️ Payment processor not configured yet.
        Add your Stripe keys to the backend <code>.env</code> file to enable payments.
      </div>`;
  }

  document.querySelector('.js-place-order').addEventListener('click', async () => {
    const btn = document.querySelector('.js-place-order');
    btn.disabled = true;
    btn.textContent = 'Placing order…';

    const orderRes = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ couponCode: appliedCoupon?.code || null })
    });
    if (!orderRes.ok) {
      document.getElementById('payment-error').textContent = 'Failed to place order.';
      btn.disabled = false;
      btn.textContent = 'Place your order';
      return;
    }
    const { orderId } = await orderRes.json();
    window.location.href = `orders.html?placed=${orderId}`;
  });
}
