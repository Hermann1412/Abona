import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import arcjet, { shield, slidingWindow, validateEmail } from '@arcjet/node';
import pool from '../db/connection.js';
import { sendPasswordReset } from '../utils/email.js';

const router = express.Router();

// Arcjet instance for registration — validates email + rate limits + shields
const registerAj = arcjet({
  key: process.env.ARCJET_KEY,
  characteristics: ['ip.src'],
  rules: [
    shield({ mode: 'LIVE' }),
    slidingWindow({ mode: 'LIVE', interval: '1h', max: 10 }),
    validateEmail({
      mode: 'LIVE',
      deny: ['DISPOSABLE', 'INVALID', 'NO_MX_RECORDS']
    })
  ]
});

// Arcjet instance for login — rate limits only
const loginAj = arcjet({
  key: process.env.ARCJET_KEY,
  characteristics: ['ip.src'],
  rules: [
    shield({ mode: 'LIVE' }),
    slidingWindow({ mode: 'LIVE', interval: '15m', max: 10 })
  ]
});

// Arcjet instance for password reset — strict rate limit + email validation
const resetAj = arcjet({
  key: process.env.ARCJET_KEY,
  characteristics: ['ip.src'],
  rules: [
    shield({ mode: 'LIVE' }),
    slidingWindow({ mode: 'LIVE', interval: '15m', max: 3 }),
    validateEmail({ mode: 'LIVE', deny: ['DISPOSABLE', 'INVALID', 'NO_MX_RECORDS'] })
  ]
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // Arcjet: validate email + rate limit
  const decision = await registerAj.protect(req, { email });
  if (decision.isDenied()) {
    if (decision.reason.isEmail()) {
      return res.status(400).json({ error: 'Please use a valid, non-disposable email address' });
    }
    if (decision.reason.isRateLimit()) {
      return res.status(429).json({ error: 'Too many requests. Please try again later' });
    }
    return res.status(403).json({ error: 'Request blocked' });
  }

  try {
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hash]
    );

    const token = jwt.sign(
      { id: result.insertId, email, name, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const isProd = process.env.ARCJET_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(201).json({ message: 'Account created', user: { name, email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Arcjet: rate limit login attempts
  const decision = await loginAj.protect(req);
  if (decision.isDenied()) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later' });
  }

  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const isProd = process.env.ARCJET_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ message: 'Logged in', user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Arcjet: rate limit + validate email
  const decision = await resetAj.protect(req, { email });
  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes before trying again.' });
    }
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const [rows] = await pool.execute('SELECT id, name FROM users WHERE email = ?', [email]);

    // Always respond OK — don't reveal if email exists (security)
    if (rows.length === 0) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Delete any existing reset tokens for this user then insert new one
    await pool.execute('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
    await pool.execute(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expiresAt]
    );

    const resetUrl = `${process.env.CLIENT_ORIGIN}/reset-password.html?token=${token}`;

    sendPasswordReset({ to: email, name: user.name, resetUrl })
      .catch(err => console.error('Reset email failed:', err));

    return res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW()',
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const { user_id } = rows[0];
    const hash = await bcrypt.hash(password, 10);

    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hash, user_id]);
    await pool.execute('DELETE FROM password_resets WHERE user_id = ?', [user_id]);

    // Clear any active session cookie so they log in fresh
    res.clearCookie('token');
    return res.json({ message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — check current session
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
});

export default router;
