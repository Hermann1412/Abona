import express from 'express';
import pool from '../db/connection.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/reviews/:productId — list approved reviews
router.get('/:productId', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.stars, r.title, r.body, r.is_verified, r.helpful_count, r.created_at,
              u.name AS user_name, u.avatar_url
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.product_id = ? AND r.is_approved = TRUE
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [req.params.productId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reviews/:productId/mine — check if current user already reviewed
router.get('/:productId/mine', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM reviews WHERE product_id = ? AND user_id = ?',
      [req.params.productId, req.user.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/reviews/:productId — submit or update a review
router.post('/:productId', verifyToken, async (req, res) => {
  const { stars, title, body } = req.body;
  const productId = req.params.productId;

  if (!stars || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Stars must be between 1 and 5' });
  }

  try {
    // Check if product exists
    const [prod] = await pool.execute('SELECT id FROM products WHERE id = ?', [productId]);
    if (!prod.length) return res.status(404).json({ error: 'Product not found' });

    // Check verified purchase (user ordered this product)
    const [orders] = await pool.execute(
      `SELECT o.id FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = ? AND oi.product_id = ? AND o.status IN ('delivered','paid','shipped')
       LIMIT 1`,
      [req.user.id, productId]
    );
    const isVerified = orders.length > 0;
    const orderId = isVerified ? orders[0].id : null;

    // Upsert review (one per user per product)
    await pool.execute(
      `INSERT INTO reviews (product_id, user_id, order_id, stars, title, body, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         stars = VALUES(stars), title = VALUES(title), body = VALUES(body),
         order_id = VALUES(order_id), is_verified = VALUES(is_verified), updated_at = NOW()`,
      [productId, req.user.id, orderId, stars, title?.trim() || null, body?.trim() || null, isVerified]
    );

    res.status(201).json({ message: 'Review submitted', isVerified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/reviews/:reviewId/helpful — mark review as helpful
router.post('/:reviewId/helpful', verifyToken, async (req, res) => {
  try {
    await pool.execute(
      'UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ?',
      [req.params.reviewId]
    );
    res.json({ message: 'Marked as helpful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/reviews/:reviewId — delete own review
router.delete('/:reviewId', verifyToken, async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM reviews WHERE id = ? AND user_id = ?',
      [req.params.reviewId, req.user.id]
    );
    res.json({ message: 'Review deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
