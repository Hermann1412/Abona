import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from '../db/connection.js';
import { requireAdminAPI, requireAdminPage } from '../middleware/adminAuth.js';
import { sendOrderShipped, sendOrderDelivered, sendOrderStatusUpdate } from '../utils/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ADMIN_DIR = join(__dirname, '../admin');

const router = express.Router();

// ─── Admin HTML page routes ───────────────────────────────────────────────────
// These serve HTML files from backend/admin/ — NOT a public folder

router.get('/login', (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'login.html'));
});

router.get('/', requireAdminPage, (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', requireAdminPage, (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'dashboard.html'));
});

router.get('/orders', requireAdminPage, (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'orders.html'));
});

router.get('/products', requireAdminPage, (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'products.html'));
});

router.get('/users', requireAdminPage, (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'users.html'));
});

router.get('/reviews', requireAdminPage, (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'reviews.html'));
});

router.get('/coupons', requireAdminPage, (req, res) => {
  res.sendFile(join(ADMIN_DIR, 'coupons.html'));
});

// Serve admin static assets (CSS, JS) — only from the admin folder
router.use('/assets', express.static(join(ADMIN_DIR, 'assets')));

// ─── Admin auth ───────────────────────────────────────────────────────────────

// POST /admin/api/login
router.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE email = ? AND role = 'admin'",
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, role: 'admin' },
      process.env.JWT_ADMIN_SECRET,
      { expiresIn: '24h' }
    );

    const isProd = process.env.ARCJET_ENV === 'production';
    res.cookie('admin_token', token, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({ message: 'Admin logged in' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/api/logout
router.post('/api/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ message: 'Logged out' });
});

// GET /admin/api/me — validate admin token for client-side auth checks
router.get('/api/me', requireAdminAPI, (req, res) => {
  res.json({ admin: req.admin });
});

// ─── Dashboard stats ──────────────────────────────────────────────────────────

router.get('/api/stats', requireAdminAPI, async (req, res) => {
  try {
    const [[{ users }]]      = await pool.execute('SELECT COUNT(*) AS users FROM users');
    const [[{ orders }]]     = await pool.execute('SELECT COUNT(*) AS orders FROM orders');
    const [[{ revenue }]]    = await pool.execute("SELECT IFNULL(SUM(total_cents),0) AS revenue FROM orders WHERE status != 'cancelled'");
    const [[{ pending }]]    = await pool.execute("SELECT COUNT(*) AS pending FROM orders WHERE status = 'pending'");
    const [[{ products }]]   = await pool.execute('SELECT COUNT(*) AS products FROM products');

    res.json({ users, orders, revenue, pending, products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Dashboard chart data ─────────────────────────────────────────────────────

router.get('/api/stats/revenue', requireAdminAPI, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT DATE(created_at) AS day,
             SUM(total_cents) AS revenue,
             COUNT(*) AS orders
      FROM orders
      WHERE status != 'cancelled' AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/api/stats/top-products', requireAdminAPI, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT oi.product_name,
             SUM(oi.quantity) AS units,
             SUM(oi.price_cents * oi.quantity) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled'
      GROUP BY oi.product_name
      ORDER BY revenue DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/api/stats/order-statuses', requireAdminAPI, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT status, COUNT(*) AS count FROM orders GROUP BY status'
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ─── Orders management ────────────────────────────────────────────────────────

router.get('/api/orders', requireAdminAPI, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, u.name AS user_name, u.email AS user_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE o.status = ?';
      params.push(status);
    }

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [orders] = await pool.execute(query, params);

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM orders${status ? " WHERE status = ?" : ""}`,
      status ? [status] : []
    );

    res.json({ orders, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/api/orders/:id/status', requireAdminAPI, async (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    await pool.execute('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: 'Order status updated' });

    // Send email notification for all meaningful status changes
    if (['shipped', 'delivered', 'paid', 'cancelled'].includes(status)) {
      const [[order]] = await pool.execute(
        `SELECT o.*, u.name AS user_name, u.email AS user_email
         FROM orders o JOIN users u ON o.user_id = u.id
         WHERE o.id = ?`,
        [req.params.id]
      );
      const [items] = await pool.execute(
        'SELECT * FROM order_items WHERE order_id = ?',
        [req.params.id]
      );

      const payload = {
        to: order.user_email,
        name: order.user_name,
        orderId: order.id,
        items,
        totalCents: order.total_cents,
        shippingCents: order.shipping_cents,
        taxCents: order.tax_cents
      };

      if (status === 'shipped') {
        sendOrderShipped(payload).catch(err => console.error('Shipped email failed:', err));
      } else if (status === 'delivered') {
        sendOrderDelivered(payload).catch(err => console.error('Delivered email failed:', err));
      } else if (status === 'paid' || status === 'cancelled') {
        sendOrderStatusUpdate({
          to: order.user_email,
          name: order.user_name,
          orderId: order.id,
          status
        }).catch(err => console.error('Status update email failed:', err));
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Products management ──────────────────────────────────────────────────────

router.get('/api/products', requireAdminAPI, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/api/products', requireAdminAPI, async (req, res) => {
  const { name, image, price_cents, description, type, stock, keywords } = req.body;
  if (!name || !price_cents) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  try {
    const id   = uuidv4();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const kw   = keywords ? JSON.stringify(keywords.split(',').map(k => k.trim()).filter(Boolean)) : null;
    const stockVal = stock !== undefined ? Number(stock) : -1;

    await pool.execute(
      `INSERT INTO products (id, name, slug, image, price_cents, base_price_cents, description, type, stock, keywords)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, slug, image || null, Number(price_cents), Number(price_cents), description || null, type || null, stockVal, kw]
    );

    res.status(201).json({ id, message: 'Product created' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/api/products/:id', requireAdminAPI, async (req, res) => {
  const { name, price_cents, stars, stock } = req.body;
  const fields = [];
  const values = [];

  if (name !== undefined)        { fields.push('name = ?');        values.push(name); }
  if (price_cents !== undefined) { fields.push('price_cents = ?'); values.push(price_cents); }
  if (stars !== undefined)       { fields.push('stars = ?');       values.push(stars); }
  if (stock !== undefined)       { fields.push('stock = ?');       values.push(Number(stock)); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  try {
    values.push(req.params.id);
    await pool.execute(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Product updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Product images ───────────────────────────────────────────────────────────

router.post('/api/products/:id/images', requireAdminAPI, async (req, res) => {
  const { url, alt_text, is_primary } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    if (is_primary) {
      await pool.execute('UPDATE product_images SET is_primary = FALSE WHERE product_id = ?', [req.params.id]);
    }
    await pool.execute(
      'INSERT INTO product_images (product_id, url, alt_text, is_primary) VALUES (?, ?, ?, ?)',
      [req.params.id, url, alt_text || null, is_primary ? 1 : 0]
    );
    res.status(201).json({ message: 'Image added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/api/products/:productId/images/:imageId', requireAdminAPI, async (req, res) => {
  try {
    await pool.execute('DELETE FROM product_images WHERE id = ? AND product_id = ?',
      [req.params.imageId, req.params.productId]);
    res.json({ message: 'Image removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Coupon management ────────────────────────────────────────────────────────

router.get('/api/coupons', requireAdminAPI, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/coupons', requireAdminAPI, async (req, res) => {
  const { code, description, type, value, min_order_cents, max_uses, max_uses_per_user, expires_at } = req.body;
  if (!code || !type || !value) return res.status(400).json({ error: 'code, type, value required' });
  try {
    await pool.execute(
      `INSERT INTO coupons (code, description, type, value, min_order_cents, max_uses, max_uses_per_user, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code.toUpperCase(), description || null, type, value,
       min_order_cents || 0, max_uses || null, max_uses_per_user || 1, expires_at || null]
    );
    res.status(201).json({ message: 'Coupon created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Coupon code already exists' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/api/coupons/:id', requireAdminAPI, async (req, res) => {
  const { is_active } = req.body;
  try {
    await pool.execute('UPDATE coupons SET is_active = ? WHERE id = ?', [is_active, req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/coupons/:id', requireAdminAPI, async (req, res) => {
  try {
    await pool.execute('DELETE FROM coupons WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ─── Review moderation ────────────────────────────────────────────────────────

router.get('/api/reviews', requireAdminAPI, async (req, res) => {
  try {
    const { status = 'all', page = 1 } = req.query;
    const limit  = 25;
    const offset = (page - 1) * limit;
    const where  = status === 'pending' ? 'WHERE r.is_approved = FALSE'
                 : status === 'approved' ? 'WHERE r.is_approved = TRUE' : '';
    const [rows] = await pool.execute(
      `SELECT r.*, u.name AS user_name, p.name AS product_name
       FROM reviews r
       JOIN users u    ON r.user_id    = u.id
       JOIN products p ON r.product_id = p.id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM reviews r ${where}`
    );
    res.json({ reviews: rows, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/api/reviews/:id', requireAdminAPI, async (req, res) => {
  const { is_approved } = req.body;
  if (is_approved === undefined) return res.status(400).json({ error: 'is_approved required' });
  try {
    await pool.execute('UPDATE reviews SET is_approved = ? WHERE id = ?', [is_approved ? 1 : 0, req.params.id]);
    res.json({ message: 'Review updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/api/reviews/:id', requireAdminAPI, async (req, res) => {
  try {
    await pool.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ message: 'Review deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Users management ────────────────────────────────────────────────────────

router.get('/api/users', requireAdminAPI, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    const [users] = await pool.execute(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM users');

    res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/api/users/:id/role', requireAdminAPI, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin"' });
  }

  try {
    // Prevent removing the last admin
    if (role === 'user') {
      const [[{ count }]] = await pool.execute(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"
      );
      if (count <= 1) {
        return res.status(400).json({ error: 'Cannot remove the only admin' });
      }
    }

    await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ message: 'Role updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
