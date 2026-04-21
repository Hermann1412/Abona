import { BrevoClient } from '@getbrevo/brevo';

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

const FROM = { email: process.env.BREVO_SENDER_EMAIL, name: 'Abona Shop' };

const fmt = cents => '฿' + (cents / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 });

function baseLayout(content) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e2022;background:#f5f5f5">
  <div style="background:#232f3e;padding:20px 32px;display:flex;align-items:center;gap:12px">
    <h1 style="color:#f0c14b;margin:0;font-size:24px;letter-spacing:1px">Abona Shop</h1>
  </div>
  <div style="background:#fff;padding:32px;margin:16px 0;border-radius:8px">
    ${content}
  </div>
  <div style="padding:16px 32px;text-align:center;font-size:12px;color:#999">
    © ${new Date().getFullYear()} Abona Shop · Thailand<br>
    <a href="${process.env.CLIENT_ORIGIN}" style="color:#f0c14b;text-decoration:none">Visit our store</a>
  </div>
</body>
</html>`;
}

function itemTable(items) {
  return `<table style="width:100%;border-collapse:collapse">
    ${items.map(item => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee;vertical-align:middle">
          <div style="font-weight:500">${item.product_name || item.name}</div>
          <div style="color:#888;font-size:13px">Qty: ${item.quantity}</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
          ${fmt((item.price_cents) * item.quantity)}
        </td>
      </tr>`).join('')}
  </table>`;
}

function orderTotals(shippingCents, taxCents, totalCents) {
  return `<table style="width:100%;margin-top:16px;font-size:14px">
    <tr>
      <td style="padding:4px 0;color:#666">Shipping</td>
      <td style="text-align:right">${shippingCents === 0 ? 'FREE' : fmt(shippingCents)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666">VAT (7%)</td>
      <td style="text-align:right">${fmt(taxCents)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;font-weight:700;font-size:16px;border-top:2px solid #232f3e">Order Total</td>
      <td style="text-align:right;font-weight:700;font-size:16px;border-top:2px solid #232f3e">${fmt(totalCents)}</td>
    </tr>
  </table>`;
}

function orderIdBadge(orderId) {
  return `<div style="background:#f7f8fc;border-radius:8px;padding:14px 16px;margin:20px 0">
    <div style="font-size:12px;color:#888">Order ID</div>
    <div style="font-family:monospace;font-size:14px;margin-top:4px">${orderId}</div>
  </div>`;
}

function viewOrderBtn(orderId) {
  return `<div style="margin-top:28px;text-align:center">
    <a href="${process.env.CLIENT_ORIGIN}/orders.html"
       style="background:#f0c14b;color:#111;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:600;display:inline-block">
      View Your Order
    </a>
  </div>`;
}

async function send({ to, subject, html }) {
  await brevo.transactionalEmails.sendTransacEmail({
    sender: FROM,
    to: [{ email: to }],
    subject,
    htmlContent: html
  });
}

// ── Admin New Order Alert ─────────────────────────────────────────────────────

export async function sendAdminOrderAlert({ orderId, customerName, customerEmail, items, totalCents, shippingCents, taxCents, discountCents }) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.BREVO_SENDER_EMAIL;
  if (!adminEmail) return;

  const discountRow = discountCents > 0
    ? `<tr><td style="padding:4px 0;color:#c40000">Discount</td><td style="text-align:right;color:#c40000">- ${fmt(discountCents)}</td></tr>`
    : '';

  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">🛒</div>
      <h2 style="margin:8px 0 4px">New Order Received!</h2>
      <p style="color:#666;margin:0">A customer just placed an order on Abona Shop.</p>
    </div>
    ${orderIdBadge(orderId)}
    <div style="background:#f7f8fc;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:12px;color:#888;margin-bottom:4px">Customer</div>
      <div style="font-weight:500">${customerName}</div>
      <div style="color:#666;font-size:13px">${customerEmail}</div>
    </div>
    ${itemTable(items)}
    <table style="width:100%;margin-top:16px;font-size:14px">
      <tr><td style="padding:4px 0;color:#666">Shipping</td><td style="text-align:right">${shippingCents === 0 ? 'FREE' : fmt(shippingCents)}</td></tr>
      ${discountRow}
      <tr><td style="padding:4px 0;color:#666">VAT (7%)</td><td style="text-align:right">${fmt(taxCents)}</td></tr>
      <tr>
        <td style="padding:8px 0;font-weight:700;font-size:16px;border-top:2px solid #232f3e">Order Total</td>
        <td style="text-align:right;font-weight:700;font-size:16px;border-top:2px solid #232f3e">${fmt(totalCents)}</td>
      </tr>
    </table>
    <div style="margin-top:28px;text-align:center">
      <a href="http://localhost:3000/admin/orders"
         style="background:#232f3e;color:#f0c14b;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:600;display:inline-block">
        View in Admin Panel
      </a>
    </div>
  `);

  await send({ to: adminEmail, subject: `🛒 New Order #${orderId.slice(0, 8).toUpperCase()} — ${customerName}`, html });
}

// ── Password Reset ────────────────────────────────────────────────────────────

export async function sendPasswordReset({ to, name, resetUrl }) {
  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">🔐</div>
      <h2 style="margin:8px 0 4px">Reset Your Password</h2>
      <p style="color:#666;margin:0">Hi ${name}, we received a request to reset your password.</p>
    </div>
    <p style="color:#444;font-size:14px">Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
    <div style="margin:28px 0;text-align:center">
      <a href="${resetUrl}"
         style="background:#f0c14b;color:#111;text-decoration:none;padding:14px 36px;border-radius:6px;font-weight:600;display:inline-block;font-size:15px">
        Reset My Password
      </a>
    </div>
    <p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    <p style="color:#888;font-size:12px;word-break:break-all">Or copy this link: ${resetUrl}</p>
  `);

  await send({ to, subject: '🔐 Reset your Abona Shop password', html });
}

// ── Order Confirmation ────────────────────────────────────────────────────────

export async function sendOrderConfirmation({ to, name, orderId, items, totalCents, shippingCents, taxCents }) {
  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">✅</div>
      <h2 style="margin:8px 0 4px">Order Confirmed!</h2>
      <p style="color:#666;margin:0">Thank you for shopping with us, ${name}!</p>
    </div>
    ${orderIdBadge(orderId)}
    <p style="color:#444;font-size:14px">We've received your order and are preparing it. You'll get another email when it ships.</p>
    ${itemTable(items)}
    ${orderTotals(shippingCents, taxCents, totalCents)}
    ${viewOrderBtn(orderId)}
  `);

  await send({ to, subject: `✅ Order Confirmed — #${orderId.slice(0, 8).toUpperCase()}`, html });
}

// ── Shipped Notification ──────────────────────────────────────────────────────

export async function sendOrderShipped({ to, name, orderId, items, totalCents, shippingCents, taxCents }) {
  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">📦</div>
      <h2 style="margin:8px 0 4px">Your Order Has Shipped!</h2>
      <p style="color:#666;margin:0">Great news, ${name} — your package is on its way!</p>
    </div>
    ${orderIdBadge(orderId)}
    <p style="color:#444;font-size:14px">Your order has been handed to the courier. You can track it from your orders page.</p>
    ${itemTable(items)}
    ${orderTotals(shippingCents, taxCents, totalCents)}
    ${viewOrderBtn(orderId)}
  `);

  await send({ to, subject: `📦 Your Order Has Shipped — #${orderId.slice(0, 8).toUpperCase()}`, html });
}

// ── Low Stock Alert ───────────────────────────────────────────────────────────

export async function sendLowStockAlert({ products }) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.BREVO_SENDER_EMAIL;
  if (!adminEmail) return;

  const rows = products.map(p => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:500">${p.name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">
        <span style="background:${p.stock === 0 ? '#fee2e2' : '#fef9c3'};
               color:${p.stock === 0 ? '#c40000' : '#92400e'};
               padding:3px 10px;border-radius:10px;font-weight:600;font-size:13px">
          ${p.stock === 0 ? 'OUT OF STOCK' : `${p.stock} left`}
        </span>
      </td>
    </tr>`).join('');

  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">⚠️</div>
      <h2 style="margin:8px 0 4px">Low Stock Alert</h2>
      <p style="color:#666;margin:0">The following products are running low after a recent order.</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 0;font-size:12px;color:#888;text-transform:uppercase">Product</th>
          <th style="text-align:right;padding:8px 0;font-size:12px;color:#888;text-transform:uppercase">Stock</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:28px;text-align:center">
      <a href="http://localhost:3000/admin/products"
         style="background:#f0c14b;color:#111;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:600;display:inline-block">
        Manage Inventory
      </a>
    </div>
  `);

  await send({ to: adminEmail, subject: `⚠️ Low Stock Alert — ${products.length} product${products.length > 1 ? 's' : ''} need attention`, html });
}

// ── Delivered Notification ────────────────────────────────────────────────────

export async function sendOrderDelivered({ to, name, orderId, items, totalCents, shippingCents, taxCents }) {
  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">🎉</div>
      <h2 style="margin:8px 0 4px">Order Delivered!</h2>
      <p style="color:#666;margin:0">Your order has arrived, ${name}!</p>
    </div>
    ${orderIdBadge(orderId)}
    <p style="color:#444;font-size:14px">We hope you love your purchase! If you have any issues, please contact our support team.</p>
    <p style="color:#444;font-size:14px">Enjoyed your shopping experience? <strong>Leave a review</strong> to help other customers.</p>
    ${itemTable(items)}
    ${orderTotals(shippingCents, taxCents, totalCents)}
    ${viewOrderBtn(orderId)}
  `);

  await send({ to, subject: `🎉 Your Order Has Been Delivered — #${orderId.slice(0, 8).toUpperCase()}`, html });
}

// ── Order Cancelled by Customer (admin alert) ─────────────────────────────────

export async function sendAdminCancelAlert({ orderId, customerName, customerEmail, totalCents }) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.BREVO_SENDER_EMAIL;
  if (!adminEmail) return;

  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">❌</div>
      <h2 style="margin:8px 0 4px">Order Cancelled by Customer</h2>
      <p style="color:#666;margin:0">A customer has cancelled their order.</p>
    </div>
    ${orderIdBadge(orderId)}
    <div style="background:#f7f8fc;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:12px;color:#888;margin-bottom:4px">Customer</div>
      <div style="font-weight:500">${customerName}</div>
      <div style="color:#666;font-size:13px">${customerEmail}</div>
    </div>
    <div style="background:#fee2e2;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:12px;color:#888;margin-bottom:4px">Order Total</div>
      <div style="font-weight:700;font-size:18px;color:#c40000">${fmt(totalCents)}</div>
    </div>
    <div style="margin-top:28px;text-align:center">
      <a href="http://localhost:3000/admin/orders"
         style="background:#232f3e;color:#f0c14b;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:600;display:inline-block">
        View in Admin Panel
      </a>
    </div>
  `);

  await send({ to: adminEmail, subject: `❌ Order Cancelled — #${orderId.slice(0, 8).toUpperCase()} by ${customerName}`, html });
}

// ── Order Status Update (customer notification) ───────────────────────────────

export async function sendOrderStatusUpdate({ to, name, orderId, status }) {
  const statusConfig = {
    paid: {
      emoji: '💳',
      title: 'Payment Confirmed',
      message: 'Your payment has been confirmed and your order is being prepared.',
      color: '#16a34a'
    },
    cancelled: {
      emoji: '❌',
      title: 'Order Cancelled',
      message: 'Your order has been cancelled. If you have any questions, please contact our support team.',
      color: '#c40000'
    }
  };

  const cfg = statusConfig[status];
  if (!cfg) return;

  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">${cfg.emoji}</div>
      <h2 style="margin:8px 0 4px">${cfg.title}</h2>
      <p style="color:#666;margin:0">Hi ${name},</p>
    </div>
    ${orderIdBadge(orderId)}
    <p style="color:#444;font-size:14px;text-align:center">${cfg.message}</p>
    ${viewOrderBtn(orderId)}
  `);

  await send({ to, subject: `${cfg.emoji} Order Update — #${orderId.slice(0, 8).toUpperCase()}`, html });
}
