import express from 'express';
import pool from '../db/connection.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/cart — get the logged-in user's cart
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.product_id, c.quantity, c.delivery_option_id,
              p.name, p.image, p.price_cents
       FROM cart_items c
       JOIN products p ON c.product_id = p.id
       WHERE c.user_id = ?`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/cart — add or increment an item
router.post('/', verifyToken, async (req, res) => {
  const { productId, quantity = 1, deliveryOptionId = '1' } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId is required' });

  try {
    await pool.execute(
      `INSERT INTO cart_items (user_id, product_id, quantity, delivery_option_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
      [req.user.id, productId, quantity, deliveryOptionId]
    );
    return res.json({ message: 'Added to cart' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/cart/:productId — update quantity or delivery option
router.patch('/:productId', verifyToken, async (req, res) => {
  const { quantity, deliveryOptionId } = req.body;

  try {
    if (quantity !== undefined) {
      if (quantity <= 0) {
        await pool.execute(
          'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?',
          [req.user.id, req.params.productId]
        );
        return res.json({ message: 'Item removed' });
      }
      await pool.execute(
        'UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?',
        [quantity, req.user.id, req.params.productId]
      );
    }

    if (deliveryOptionId !== undefined) {
      await pool.execute(
        'UPDATE cart_items SET delivery_option_id = ? WHERE user_id = ? AND product_id = ?',
        [deliveryOptionId, req.user.id, req.params.productId]
      );
    }

    return res.json({ message: 'Cart updated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/cart/:productId
router.delete('/:productId', verifyToken, async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?',
      [req.user.id, req.params.productId]
    );
    return res.json({ message: 'Item removed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/cart — clear the whole cart
router.delete('/', verifyToken, async (req, res) => {
  try {
    await pool.execute('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
    return res.json({ message: 'Cart cleared' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
