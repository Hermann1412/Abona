import express from 'express';
import pool from '../db/connection.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/coupons/validate — check a coupon code and return the discount
router.post('/validate', verifyToken, async (req, res) => {
  const { code, subtotalCents } = req.body;
  if (!code) return res.status(400).json({ error: 'Coupon code required' });

  try {
    const [rows] = await pool.execute(
      `SELECT * FROM coupons WHERE code = ? AND is_active = TRUE`,
      [code.trim().toUpperCase()]
    );

    if (!rows.length) return res.status(404).json({ error: 'Invalid coupon code' });
    const coupon = rows[0];

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This coupon has expired' });
    }

    // Check max uses globally
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
      return res.status(400).json({ error: 'This coupon has reached its usage limit' });
    }

    // Check per-user usage
    const [used] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM coupon_uses WHERE coupon_id = ? AND user_id = ?',
      [coupon.id, req.user.id]
    );
    if (used[0].cnt >= coupon.max_uses_per_user) {
      return res.status(400).json({ error: 'You have already used this coupon' });
    }

    // Check minimum order
    if (subtotalCents && coupon.min_order_cents > 0 && subtotalCents < coupon.min_order_cents) {
      return res.status(400).json({
        error: `Minimum order of ฿${(coupon.min_order_cents / 100).toFixed(2)} required for this coupon`
      });
    }

    // Calculate discount
    let discountCents = 0;
    if (coupon.type === 'percentage') {
      discountCents = Math.round((subtotalCents || 0) * (coupon.value / 100));
    } else {
      discountCents = Math.round(coupon.value * 100);
    }
    // Cap discount at subtotal
    discountCents = Math.min(discountCents, subtotalCents || discountCents);

    return res.json({
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      value: parseFloat(coupon.value),
      discountCents
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
