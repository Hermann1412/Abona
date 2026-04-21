import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/connection.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/users/me — full profile
router.get('/me', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, avatar_url, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/me — update profile (name, phone, avatar_url)
router.patch('/me', verifyToken, async (req, res) => {
  const { name, phone, avatar_url } = req.body;
  const fields = [];
  const values = [];

  if (name)       { fields.push('name = ?');       values.push(name.trim()); }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone || null); }
  if (avatar_url !== undefined) { fields.push('avatar_url = ?'); values.push(avatar_url || null); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  try {
    values.push(req.user.id);
    await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Profile updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/me/password — change password
router.patch('/me/password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const [rows] = await pool.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/users/me — delete account
router.delete('/me', verifyToken, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required to delete account' });

  try {
    const [rows] = await pool.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    await pool.execute('DELETE FROM users WHERE id = ?', [req.user.id]);
    res.clearCookie('token');
    res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/me/addresses
router.get('/me/addresses', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/me/addresses
router.post('/me/addresses', verifyToken, async (req, res) => {
  const { label, full_name, phone, line1, line2, city, state, postal_code, country, is_default } = req.body;
  if (!full_name || !line1 || !city || !postal_code) {
    return res.status(400).json({ error: 'Name, address, city, and postal code are required' });
  }

  try {
    if (is_default) {
      await pool.execute('UPDATE addresses SET is_default = FALSE WHERE user_id = ?', [req.user.id]);
    }
    const [result] = await pool.execute(
      `INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, label || 'Home', full_name, phone || null, line1, line2 || null,
       city, state || null, postal_code, country || 'TH', is_default ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, message: 'Address added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/users/me/addresses/:id
router.delete('/me/addresses/:id', verifyToken, async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM addresses WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Address deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
