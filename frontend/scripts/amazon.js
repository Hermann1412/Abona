import { cart, loadCart, addToCart, getCartQuantity } from '../data/cart.js';
import { initAuth, updateCartBadge } from './auth.js';
import { initChat } from './chat.js';
import { formatCurrency } from './utils/money.js';
import { API_BASE } from './utils/api.js';

let allProducts    = [];
let activeType     = '';
let activeSearch   = '';
let activeMinPrice = 0;
let activeMaxPrice = Infinity;
let activeMinRating = 0;
let wishlistIds    = new Set();
let isLoggedIn     = false;

async function loadWishlistIds() {
  try {
    const res = await fetch(`${API_BASE}/api/wishlist/ids`, { credentials: 'include' });
    if (res.ok) {
      const ids = await res.json();
      wishlistIds = new Set(ids);
    }
  } catch { /* not logged in or offline */ }
}

async function toggleWishlist(productId, btn) {
  if (!isLoggedIn) {
    window.location.href = 'login.html';
    return;
  }
  const inList = wishlistIds.has(productId);
  const method = inList ? 'DELETE' : 'POST';
  try {
    const res = await fetch(`${API_BASE}/api/wishlist/${productId}`, {
      method,
      credentials: 'include'
    });
    if (res.ok) {
      if (inList) {
        wishlistIds.delete(productId);
        btn.classList.remove('wishlisted');
        btn.title = 'Add to Wishlist';
      } else {
        wishlistIds.add(productId);
        btn.classList.add('wishlisted');
        btn.title = 'Remove from Wishlist';
      }
    }
  } catch { /* ignore */ }
}

function productCard(product) {
  const sizeChart = product.type === 'clothing' && product.sizeChartLink
    ? `<div>
         <a href="${product.sizeChartLink}" target="_blank" class="link-primary" style="font-size:12px">
           Size chart
         </a>
       </div>`
    : '';

  const hearted    = wishlistIds.has(product.id);
  const outOfStock = product.stock === 0;
  const lowStock   = product.stock > 0 && product.stock <= 5;

  return `
    <div class="product-container">
      <div class="product-image-container">
        <a href="product.html?id=${product.id}">
          <img class="product-image" src="${product.image}" loading="lazy"
            onerror="this.src='images/icons/cart-icon.png'"
            style="${outOfStock ? 'opacity:0.5' : ''}">
        </a>
        ${outOfStock ? `<div class="stock-tag stock-tag-out">Out of Stock</div>` : ''}
        ${lowStock   ? `<div class="stock-tag stock-tag-low">Only ${product.stock} left</div>` : ''}
        <button class="wishlist-btn js-wishlist-btn ${hearted ? 'wishlisted' : ''}"
          data-product-id="${product.id}"
          title="${hearted ? 'Remove from Wishlist' : 'Add to Wishlist'}">
          ♥
        </button>
      </div>

      <div class="product-name limit-text-to-2-lines">
        <a href="product.html?id=${product.id}" class="link-primary"
           style="text-decoration:none;color:inherit">${product.name}</a>
      </div>

      <div class="product-rating-container">
        ${product.rating.count > 0
          ? `<img class="product-rating-stars"
               src="images/ratings/rating-${Math.round(product.rating.stars * 2) * 5}.png"
               onerror="this.style.display='none'">
             <div class="product-rating-count link-primary">${product.rating.count}</div>`
          : `<span style="font-size:12px;color:#888">No reviews yet</span>`
        }
      </div>

      <div class="product-price">฿${formatCurrency(product.priceCents)}</div>

      ${sizeChart}

      <div class="product-quantity-container">
        <select class="js-quantity-select" data-product-id="${product.id}">
          ${[1,2,3,4,5,6,7,8,9,10].map(n =>
            `<option value="${n}">${n}</option>`).join('')}
        </select>
      </div>

      <div class="product-spacer"></div>

      <div class="added-to-cart js-added-${product.id}" style="display:none">
        <img src="images/icons/checkmark.png"> Added
      </div>

      ${outOfStock
        ? `<button class="add-to-cart-button button-primary" disabled
              style="opacity:0.45;cursor:not-allowed">Out of Stock</button>`
        : `<button class="add-to-cart-button button-primary js-add-to-cart"
              data-product-id="${product.id}">Add to Cart</button>`
      }
    </div>
  `;
}

function applyFilters() {
  let results = allProducts;

  if (activeType) {
    results = results.filter(p => p.type === activeType);
  }

  if (activeSearch) {
    const q = activeSearch.toLowerCase();
    results = results.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.keywords || []).some(k => k.toLowerCase().includes(q))
    );
  }

  if (activeMinPrice > 0) {
    results = results.filter(p => p.priceCents >= activeMinPrice * 100);
  }
  if (activeMaxPrice < Infinity) {
    results = results.filter(p => p.priceCents <= activeMaxPrice * 100);
  }
  if (activeMinRating > 0) {
    results = results.filter(p => p.rating.stars >= activeMinRating);
  }

  // Update search status label
  const status = document.querySelector('.js-search-status');
  if (status) {
    if (activeSearch || activeType) {
      const label = activeSearch ? `"${activeSearch}"` : '';
      const typeLabel = activeType ? activeType.charAt(0).toUpperCase() + activeType.slice(1) : '';
      const parts = [typeLabel, label].filter(Boolean).join(' › ');
      status.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for ${parts}`;
      status.style.display = 'block';
    } else {
      status.style.display = 'none';
    }
  }

  renderProducts(results);
}

function renderProducts(products) {
  const grid = document.querySelector('.js-products-grid');
  if (!products.length) {
    grid.innerHTML = `
      <div style="padding:48px;text-align:center;color:#666;grid-column:1/-1">
        <p style="font-size:18px;margin-bottom:12px">No products found.</p>
        <button onclick="clearFilters()" style="background:linear-gradient(135deg,#c73060,#a8264f);border:1px solid #8c1e40;color:#fff;padding:8px 20px;border-radius:20px;cursor:pointer;font-size:14px;font-weight:600">
          Clear filters
        </button>
      </div>`;
    return;
  }
  grid.innerHTML = products.map(productCard).join('');

  document.querySelectorAll('.js-add-to-cart').forEach(button => {
    button.addEventListener('click', async () => {
      const productId = button.dataset.productId;
      const qty = Number(
        document.querySelector(`.js-quantity-select[data-product-id="${productId}"]`).value
      );

      button.disabled = true;
      await addToCart(productId, qty);
      button.disabled = false;

      updateCartBadge(getCartQuantity());

      const addedEl = document.querySelector(`.js-added-${productId}`);
      if (addedEl) {
        addedEl.style.display = 'flex';
        setTimeout(() => { addedEl.style.display = 'none'; }, 2000);
      }
    });
  });

  document.querySelectorAll('.js-wishlist-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleWishlist(btn.dataset.productId, btn);
    });
  });
}

window.clearFilters = function () {
  activeSearch    = '';
  activeType      = '';
  activeMinPrice  = 0;
  activeMaxPrice  = Infinity;
  activeMinRating = 0;
  document.querySelector('.js-search-bar').value = '';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.type === ''));
  const minEl = document.getElementById('minPrice');
  const maxEl = document.getElementById('maxPrice');
  if (minEl) minEl.value = '';
  if (maxEl) maxEl.value = '';
  document.querySelectorAll('.rating-chip').forEach(b => b.classList.toggle('active', b.dataset.minStars === '0'));
  applyFilters();
};

function setupSearch() {
  const bar = document.querySelector('.js-search-bar');
  const btn = document.querySelector('.js-search-button');

  function doSearch() {
    activeSearch = bar.value.trim();
    applyFilters();
  }

  btn.addEventListener('click', doSearch);
  bar.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // Clear search when bar is emptied
  bar.addEventListener('input', () => {
    if (!bar.value.trim()) {
      activeSearch = '';
      applyFilters();
    }
  });

  // Handle search passed via URL hash from other pages: index.html#search:query
  const hash = window.location.hash;
  if (hash.startsWith('#search:')) {
    const q = decodeURIComponent(hash.slice(8));
    bar.value = q;
    activeSearch = q;
  }
}

function setupFilters() {
  const applyBtn = document.getElementById('applyPrice');
  const minEl    = document.getElementById('minPrice');
  const maxEl    = document.getElementById('maxPrice');

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      activeMinPrice = parseFloat(minEl.value) || 0;
      activeMaxPrice = parseFloat(maxEl.value) || Infinity;
      applyFilters();
    });
    [minEl, maxEl].forEach(el => {
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') applyBtn.click(); });
    });
  }

  document.querySelectorAll('.rating-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rating-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMinRating = parseFloat(btn.dataset.minStars) || 0;
      applyFilters();
    });
  });
}

function setupCategories() {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeType = btn.dataset.type;
      applyFilters();
    });
  });
}

async function init() {
  const user = await initAuth();
  isLoggedIn = !!user;
  initChat(user);
  await Promise.all([loadCart(), isLoggedIn ? loadWishlistIds() : Promise.resolve()]);
  updateCartBadge(getCartQuantity());

  try {
    const res = await fetch(`${API_BASE}/api/products`);
    if (res.ok) {
      allProducts = await res.json();
    }
  } catch {
    const { products } = await import('../data/products.js');
    allProducts = products;
  }

  setupSearch();
  setupCategories();
  setupFilters();
  applyFilters();
}

init();
