import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/connection.js';
import { requireAdminAPI } from '../middleware/adminAuth.js';

// Accepts either customer token or admin token
function verifyAny(req, res, next) {
  const token = req.cookies?.token;
  const adminToken = req.cookies?.admin_token;
  try {
    if (token) {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      req.user.isAdmin = false;
      return next();
    }
    if (adminToken) {
      req.user = jwt.verify(adminToken, process.env.JWT_ADMIN_SECRET);
      req.user.isAdmin = true;
      return next();
    }
    return res.status(401).json({ error: 'Not authenticated' });
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

const router = express.Router();

// ── REST: get or create conversation for logged-in customer ──────────────────

router.get('/conversation', verifyAny, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM conversations WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );
    if (rows.length) return res.json(rows[0]);

    const [result] = await pool.execute(
      'INSERT INTO conversations (user_id) VALUES (?)',
      [req.user.id]
    );
    const [conv] = await pool.execute('SELECT * FROM conversations WHERE id = ?', [result.insertId]);
    res.json(conv[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── REST: get messages for a conversation ─────────────────────────────────────

router.get('/conversation/:id/messages', verifyAny, async (req, res) => {
  try {
    const convId = req.params.id;

    // Customers can only read their own conversations
    if (!req.user.isAdmin) {
      const [conv] = await pool.execute(
        'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
        [convId, req.user.id]
      );
      if (!conv.length) return res.status(403).json({ error: 'Forbidden' });
    }

    const [messages] = await pool.execute(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [convId]
    );

    // Mark messages as read
    await pool.execute(
      'UPDATE chat_messages SET is_read = TRUE WHERE conversation_id = ? AND sender_type = ?',
      [convId, req.user.role === 'admin' ? 'customer' : 'admin']
    );

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── REST: admin — list all open conversations ─────────────────────────────────

router.get('/conversations', requireAdminAPI, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.*, u.name AS user_name, u.email AS user_email,
        (SELECT COUNT(*) FROM chat_messages m
         WHERE m.conversation_id = c.id AND m.is_read = FALSE AND m.sender_type = 'customer') AS unread
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      ORDER BY c.updated_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── REST: admin — close a conversation ───────────────────────────────────────

router.patch('/conversation/:id/close', requireAdminAPI, async (req, res) => {
  try {
    await pool.execute("UPDATE conversations SET status = 'closed' WHERE id = ?", [req.params.id]);
    res.json({ message: 'Conversation closed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bot helper ────────────────────────────────────────────────────────────────

const BOT_URL = process.env.BOT_URL || 'http://localhost:8000';
const AUTO_REPLY_DELAY = 30000; // 30 seconds
const adminReplyTimers = new Map(); // conversationId → timer

async function askBot(message, conversationId, forceAutoReply = false) {
  try {
    const res = await fetch(`${BOT_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversation_id: String(conversationId), force_auto_reply: forceAutoReply })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // bot offline — fail silently
  }
}

async function saveBotMessage(conversationId, text) {
  const [result] = await pool.execute(
    'INSERT INTO chat_messages (conversation_id, sender_type, sender_id, message) VALUES (?, "admin", 0, ?)',
    [conversationId, text]
  );
  await pool.execute('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);
  const [rows] = await pool.execute('SELECT * FROM chat_messages WHERE id = ?', [result.insertId]);
  return { ...rows[0], is_bot: true };
}

// ── Socket.io handlers ────────────────────────────────────────────────────────

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const user = socket.user;

    if (user.isAdmin) {
      socket.on('admin:join', (conversationId) => {
        socket.join(`conv:${conversationId}`);
      });

      socket.on('admin:message', async ({ conversationId, message }) => {
        if (!message?.trim()) return;
        try {
          // Cancel bot auto-reply timer — admin is here
          clearTimeout(adminReplyTimers.get(conversationId));
          adminReplyTimers.delete(conversationId);

          const [result] = await pool.execute(
            'INSERT INTO chat_messages (conversation_id, sender_type, sender_id, message) VALUES (?, "admin", ?, ?)',
            [conversationId, user.id, message.trim()]
          );
          await pool.execute('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);
          const [rows] = await pool.execute('SELECT * FROM chat_messages WHERE id = ?', [result.insertId]);
          socket.emit('chat:message', rows[0]);
          socket.to(`conv:${conversationId}`).emit('chat:message', rows[0]);
        } catch (err) {
          console.error('Admin message error:', err);
        }
      });
    } else {
      // Customer init — get or create conversation, return ID + history
      socket.on('customer:init', async (_, callback) => {
        try {
          let [rows] = await pool.execute(
            "SELECT * FROM conversations WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
            [user.id]
          );
          let conv = rows[0];
          if (!conv) {
            const [result] = await pool.execute(
              'INSERT INTO conversations (user_id) VALUES (?)', [user.id]
            );
            const [newRows] = await pool.execute(
              'SELECT * FROM conversations WHERE id = ?', [result.insertId]
            );
            conv = newRows[0];
          }
          const [messages] = await pool.execute(
            'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [conv.id]
          );
          await pool.execute(
            "UPDATE chat_messages SET is_read = TRUE WHERE conversation_id = ? AND sender_type = 'admin'",
            [conv.id]
          );
          callback({ conversationId: conv.id, messages });
        } catch (err) {
          console.error('customer:init error:', err);
          callback({ error: err.message });
        }
      });

      socket.on('customer:join', (conversationId) => {
        socket.join(`conv:${conversationId}`);
      });

      socket.on('customer:message', async ({ conversationId, message }) => {
        if (!message?.trim()) return;
        try {
          const [conv] = await pool.execute(
            'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, user.id]
          );
          if (!conv.length) return;

          // Save customer message
          const [result] = await pool.execute(
            'INSERT INTO chat_messages (conversation_id, sender_type, sender_id, message) VALUES (?, "customer", ?, ?)',
            [conversationId, user.id, message.trim()]
          );
          await pool.execute('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);
          const [rows] = await pool.execute('SELECT * FROM chat_messages WHERE id = ?', [result.insertId]);
          socket.emit('chat:message', rows[0]);
          socket.to(`conv:${conversationId}`).emit('chat:message', rows[0]);
          io.emit('admin:new_message', { conversationId, userName: user.name });

          // If message contains @abona → reply instantly with bot
          if (message.toLowerCase().includes('@abona')) {
            const bot = await askBot(message, conversationId);
            if (bot?.reply) {
              const botMsg = await saveBotMessage(conversationId, bot.reply);
              socket.emit('chat:message', { ...botMsg, products: bot.products || [] });
              socket.to(`conv:${conversationId}`).emit('chat:message', { ...botMsg, products: bot.products || [] });
            }
            return; // skip 30s timer when bot already replied
          }

          // Start 30-second timer — if admin doesn't reply, bot sends auto-reply
          clearTimeout(adminReplyTimers.get(conversationId));
          const timer = setTimeout(async () => {
            adminReplyTimers.delete(conversationId);
            const bot = await askBot(message, conversationId, true);
            if (bot?.reply) {
              const botMsg = await saveBotMessage(conversationId, bot.reply);
              io.to(`conv:${conversationId}`).emit('chat:message', { ...botMsg, products: [] });
            }
          }, AUTO_REPLY_DELAY);
          adminReplyTimers.set(conversationId, timer);

        } catch (err) {
          console.error('Customer message error:', err);
        }
      });
    }
  });
}

export default router;
