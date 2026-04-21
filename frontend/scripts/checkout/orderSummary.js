import { cart, removeFromCart, updateDeliveryOption, updateQuantity } from '../../data/cart.js';
import { formatCurrency } from '../utils/money.js';
import { deliveryOptions, getDeliveryOption } from '../../data/deliveryOptions.js';
import { renderPaymentSummary } from './paymentSummary.js';
import dayjs from 'https://unpkg.com/dayjs@1.11.10/esm/index.js';

export function renderOrderSummary() {
  if (!cart.length) {
    document.querySelector('.js-order-summary').innerHTML = `
      <div style="padding:32px;text-align:center;color:#666">
        <p style="font-size:18px;margin-bottom:12px">Your cart is empty</p>
        <a href="index.html" class="button-primary" style="text-decoration:none;padding:10px 20px;border-radius:4px">
          Continue shopping
        </a>
      </div>`;
    return;
  }

  let cartSummaryHTML = '';

  cart.forEach(cartItem => {
    // Cart items from the backend include product details
    const productName  = cartItem.name  || cartItem.productName  || 'Product';
    const productImage = cartItem.image || cartItem.productImage || '';
    const priceCents   = cartItem.priceCents || cartItem.price_cents || 0;
    const productId    = cartItem.productId;

    const deliveryOption = getDeliveryOption(cartItem.deliveryOptionId) || deliveryOptions[0];
    const deliveryDate   = dayjs().add(deliveryOption.deliveryDays, 'days').format('dddd, MMM D');

    const priceLabel = deliveryOption.priceCents === 0
      ? 'FREE'
      : `฿${formatCurrency(deliveryOption.priceCents)}`;

    cartSummaryHTML += `
      <div class="cart-item-container js-cart-item-container js-cart-item-container-${productId}">
        <div class="delivery-date">Delivery date: ${deliveryDate}</div>

        <div class="cart-item-details-grid">
          <img class="product-image" src="${productImage}">

          <div class="cart-item-details">
            <div class="product-name">${productName}</div>
            <div class="product-price">฿${formatCurrency(priceCents)}</div>

            <div class="product-quantity js-product-quantity-${productId}">
              <span class="js-quantity-display-${productId}">
                Quantity: <span class="quantity-label">${cartItem.quantity}</span>
              </span>
              <span class="update-quantity-link link-primary js-update-link"
                data-product-id="${productId}" style="cursor:pointer">
                Update
              </span>
              <span class="delete-quantity-link link-primary js-delete-link"
                data-product-id="${productId}" style="cursor:pointer">
                Delete
              </span>

              <!-- Hidden update form, shown on "Update" click -->
              <div class="js-update-form-${productId}" style="display:none;margin-top:8px;gap:6px;align-items:center">
                <input type="number" min="1" max="10" value="${cartItem.quantity}"
                  class="js-new-qty-${productId}"
                  style="width:60px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px">
                <span class="link-primary js-save-qty" data-product-id="${productId}"
                  style="cursor:pointer;font-size:13px">Save</span>
                <span class="link-primary js-cancel-qty" data-product-id="${productId}"
                  style="cursor:pointer;font-size:13px">Cancel</span>
              </div>
            </div>
          </div>

          <div class="delivery-options">
            <div class="delivery-options-title">Choose a delivery option:</div>
            ${deliveryOptionsHTML(productId, cartItem)}
          </div>
        </div>
      </div>
    `;
  });

  document.querySelector('.js-order-summary').innerHTML = cartSummaryHTML;

  // ── Delete handlers ──────────────────────────────────────────────────────────
  document.querySelectorAll('.js-delete-link').forEach(link => {
    link.addEventListener('click', async () => {
      const productId = link.dataset.productId;
      await removeFromCart(productId);
      document.querySelector(`.js-cart-item-container-${productId}`)?.remove();
      renderPaymentSummary();
    });
  });

  // ── Update quantity — show form ───────────────────────────────────────────────
  document.querySelectorAll('.js-update-link').forEach(link => {
    link.addEventListener('click', () => {
      const id = link.dataset.productId;
      document.querySelector(`.js-quantity-display-${id}`).style.display = 'none';
      link.style.display = 'none';
      document.querySelector(`.js-update-form-${id}`).style.display = 'flex';
    });
  });

  // ── Save new quantity ────────────────────────────────────────────────────────
  document.querySelectorAll('.js-save-qty').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id  = btn.dataset.productId;
      const qty = parseInt(document.querySelector(`.js-new-qty-${id}`).value);
      if (isNaN(qty) || qty < 1) return;

      await updateQuantity(id, qty);
      renderOrderSummary();
      renderPaymentSummary();
    });
  });

  // ── Cancel update ────────────────────────────────────────────────────────────
  document.querySelectorAll('.js-cancel-qty').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.productId;
      document.querySelector(`.js-quantity-display-${id}`).style.display = '';
      document.querySelector(`.js-update-link[data-product-id="${id}"]`).style.display = '';
      document.querySelector(`.js-update-form-${id}`).style.display = 'none';
    });
  });

  // ── Delivery option change ────────────────────────────────────────────────────
  document.querySelectorAll('.js-delivery-option').forEach(el => {
    el.addEventListener('click', async () => {
      const { productId, deliveryOptionId } = el.dataset;
      await updateDeliveryOption(productId, deliveryOptionId);
      renderOrderSummary();
      renderPaymentSummary();
    });
  });
}

function deliveryOptionsHTML(productId, cartItem) {
  return deliveryOptions.map(option => {
    const date  = dayjs().add(option.deliveryDays, 'days').format('dddd, MMM D');
    const price = option.priceCents === 0 ? 'FREE' : `฿${formatCurrency(option.priceCents)} -`;
    const checked = option.id === cartItem.deliveryOptionId;

    return `
      <div class="delivery-option js-delivery-option"
        data-product-id="${productId}"
        data-delivery-option-id="${option.id}"
        style="cursor:pointer">
        <input type="radio" ${checked ? 'checked' : ''}
          class="delivery-option-input" name="${productId}">
        <div>
          <div class="delivery-option-date">${date}</div>
          <div class="delivery-option-price">${price} Shipping</div>
        </div>
      </div>`;
  }).join('');
}
