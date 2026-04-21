import express from 'express';
import pool from '../db/connection.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// Ensure user has a wishlist row, return its id
async function getOrCreateWishlist(conn, userId) {
  const [rows] = await conn.execute(
    'SELECT id FROM wishlists WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (rows.length) return rows[0].id;
  const [result] = await conn.execute(
    "INSERT INTO wishlists (user_id, name) VALUES (?, 'My Wishlist')",
    [userId]
  );
  return result.insertId;
}

// GET /api/wishlist — list all wishlist product ids (and full product data)
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.image, p.price_cents, p.stars, p.rating_count, p.type
       FROM wishlist_items wi
       JOIN wishlists w  ON wi.wishlist_id = w.id
       JOIN products  p  ON wi.product_id  = p.id
       WHERE w.user_id = ?
       ORDER BY wi.added_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/wishlist/ids — just the product ids (for quick heart state sync)
router.get('/ids', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT wi.product_id
       FROM wishlist_items wi
       JOIN wishlists w ON wi.wishlist_id = w.id
       WHERE w.user_id = ?`,
      [req.user.id]
    );
    res.json(rows.map(r => r.product_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/wishlist/:productId — add to wishlist
router.post('/:productId', verifyToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const wishlistId = await getOrCreateWishlist(conn, req.user.id);
    await conn.execute(
      'INSERT IGNORE INTO wishlist_items (wishlist_id, product_id) VALUES (?, ?)',
      [wishlistId, req.params.productId]
    );
    res.json({ message: 'Added to wishlist' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// DELETE /api/wishlist/:productId — remove from wishlist
router.delete('/:productId', verifyToken, async (req, res) => {
  try {
    await pool.execute(
      `DELETE wi FROM wishlist_items wi
       JOIN wishlists w ON wi.wishlist_id = w.id
       WHERE w.user_id = ? AND wi.product_id = ?`,
      [req.user.id, req.params.productId]
    );
    res.json({ message: 'Removed from wishlist' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
