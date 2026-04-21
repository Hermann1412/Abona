import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db/connection.js';
import { verifyToken } from '../middleware/auth.js';
import { sendOrderConfirmation, sendAdminOrderAlert, sendLowStockAlert, sendAdminCancelAlert } from '../utils/email.js';

const router = express.Router();

const DELIVERY_PRICES = { '1': 0, '2': 15900, '3': 31900 }; // THB satang: Free / ฿159 / ฿319
const TAX_RATE = 0.07; // Thailand VAT 7%

// GET /api/orders — get the logged-in user's orders
router.get('/', verifyToken, async (req, res) => {
  try {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    for (const order of orders) {
      const [items] = await pool.execute(
        'SELECT * FROM order_items WHERE order_id = ?',
        [order.id]
      );
      order.items = items;
    }

    return res.json(orders);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/orders — place an order from the current cart
router.post('/', verifyToken, async (req, res) => {
  const { couponCode } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cartItems] = await conn.execute(
      `SELECT c.*, p.name, p.image, p.price_cents
       FROM cart_items c
       JOIN products p ON c.product_id = p.id
       WHERE c.user_id = ?`,
      [req.user.id]
    );

    if (cartItems.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Your cart is empty' });
    }

    let productTotal = 0;
    let shippingTotal = 0;

    for (const item of cartItems) {
      productTotal += item.price_cents * item.quantity;
      shippingTotal += DELIVERY_PRICES[item.delivery_option_id] ?? 0;
    }

    // Apply coupon if provided
    let discountCents = 0;
    let couponId = null;

    if (couponCode) {
      const [coupons] = await conn.execute(
        `SELECT * FROM coupons WHERE code = ? AND is_active = TRUE`,
        [couponCode.trim().toUpperCase()]
      );
      const coupon = coupons[0];

      if (coupon && (!coupon.expires_at || new Date(coupon.expires_at) >= new Date())
          && (coupon.max_uses === null || coupon.uses_count < coupon.max_uses)) {
        couponId = coupon.id;
        if (coupon.type === 'percentage') {
          discountCents = Math.round(productTotal * (coupon.value / 100));
        } else {
          discountCents = Math.round(coupon.value * 100);
        }
        discountCents = Math.min(discountCents, productTotal);
      }
    }

    const subtotalAfterDiscount = productTotal - discountCents;
    const totalBeforeTax = subtotalAfterDiscount + shippingTotal;
    const tax   = Math.round(totalBeforeTax * TAX_RATE);
    const total = totalBeforeTax + tax;
    const orderId = uuidv4();

    await conn.execute(
      `INSERT INTO orders (id, user_id, coupon_id, subtotal_cents, shipping_cents, discount_cents, tax_cents, total_cents,
        shipping_name, shipping_line1, shipping_city, shipping_postal_code, shipping_country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, req.user.id, couponId, productTotal, shippingTotal, discountCents, tax, total,
       req.user.name, 'N/A', 'N/A', '00000', 'TH']
    );

    for (const item of cartItems) {
      await conn.execute(
        `INSERT INTO order_items
           (order_id, product_id, product_name, product_image, price_cents, quantity, delivery_option_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.name, item.image,
         item.price_cents, item.quantity, item.delivery_option_id]
      );
    }

    // Record coupon usage
    if (couponId) {
      await conn.execute(
        'INSERT INTO coupon_uses (coupon_id, user_id, order_id) VALUES (?, ?, ?)',
        [couponId, req.user.id, orderId]
      );
    }

    // Decrement stock for products that have finite stock (stock > 0)
    const lowStockProducts = [];
    for (const item of cartItems) {
      const [[prod]] = await conn.execute('SELECT stock FROM products WHERE id = ?', [item.product_id]);
      if (prod && prod.stock > 0) {
        const newStock = Math.max(0, prod.stock - item.quantity);
        await conn.execute('UPDATE products SET stock = ? WHERE id = ?', [newStock, item.product_id]);
        if (newStock <= 5) {
          lowStockProducts.push({ name: item.name, stock: newStock, id: item.product_id });
        }
      }
    }

    await conn.execute('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
    await conn.commit();

    // Alert admin for any low-stock products (non-blocking)
    if (lowStockProducts.length > 0) {
      sendLowStockAlert({ products: lowStockProducts })
        .catch(err => console.error('Low stock alert failed:', err));
    }

    sendOrderConfirmation({
      to: req.user.email,
      name: req.user.name,
      orderId,
      items: cartItems,
      totalCents: total,
      shippingCents: shippingTotal,
      taxCents: tax,
      discountCents
    }).catch(err => console.error('Confirmation email failed:', err));

    sendAdminOrderAlert({
      orderId,
      customerName: req.user.name,
      customerEmail: req.user.email,
      items: cartItems,
      totalCents: total,
      shippingCents: shippingTotal,
      taxCents: tax,
      discountCents
    }).catch(err => console.error('Admin alert email failed:', err));

    return res.status(201).json({ message: 'Order placed', orderId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// PATCH /api/orders/:id/cancel — customer cancels their own pending/paid order
router.patch('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });

    const order = orders[0];
    if (!['pending', 'paid'].includes(order.status)) {
      return res.status(400).json({ error: 'Only pending or paid orders can be cancelled' });
    }

    await pool.execute(
      "UPDATE orders SET status = 'cancelled' WHERE id = ?",
      [req.params.id]
    );

    sendAdminCancelAlert({
      orderId: order.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      totalCents: order.total_cents
    }).catch(err => console.error('Admin cancel alert failed:', err));

    res.json({ message: 'Order cancelled' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders/:id — get a specific order (must belong to user)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (orders.length === 0) return res.status(404).json({ error: 'Order not found' });

    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [req.params.id]
    );
    orders[0].items = items;

    return res.json(orders[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
