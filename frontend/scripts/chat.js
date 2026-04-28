import { API_BASE } from './utils/api.js';

const SOCKET_URL = API_BASE.replace('/api', '').replace('http', 'http');

let socket = null;
let conversationId = null;
let currentUser = null;

const CSS = `
  #abona-chat-btn {
    position: fixed; bottom: 28px; right: 28px; z-index: 9999;
    width: 56px; height: 56px; border-radius: 50%;
    background: linear-gradient(135deg, #c73060, #8b1a40);
    border: none; cursor: pointer; box-shadow: 0 4px 18px rgba(199,48,96,0.45);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s; color: #fff; font-size: 22px;
  }
  #abona-chat-btn:hover { transform: scale(1.08); }
  #abona-chat-badge {
    position: absolute; top: -4px; right: -4px;
    background: #f0c14b; color: #111; font-size: 11px; font-weight: 700;
    width: 18px; height: 18px; border-radius: 50%;
    display: none; align-items: center; justify-content: center;
  }
  #abona-chat-box {
    position: fixed; bottom: 96px; right: 28px; z-index: 9998;
    width: 340px; max-height: 500px;
    background: #fff; border-radius: 16px;
    box-shadow: 0 8px 40px rgba(30,16,64,0.18);
    display: none; flex-direction: column; overflow: hidden;
    font-family: 'Roboto', Arial, sans-serif;
  }
  #abona-chat-box.open { display: flex; }
  .chat-header {
    background: linear-gradient(135deg, #c73060, #8b1a40);
    color: #fff; padding: 14px 18px;
    display: flex; align-items: center; gap: 10px;
  }
  .chat-header-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  .chat-header-info { flex: 1; }
  .chat-header-name { font-weight: 600; font-size: 14px; }
  .chat-header-status { font-size: 11px; opacity: 0.8; }
  .chat-messages {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 10px;
    min-height: 200px; max-height: 320px;
    background: #faf9fc;
  }
  .chat-bubble {
    max-width: 78%; padding: 9px 13px; border-radius: 14px;
    font-size: 13px; line-height: 1.5; word-break: break-word;
  }
  .chat-bubble.mine {
    background: #c73060; color: #fff;
    align-self: flex-end; border-bottom-right-radius: 4px;
  }
  .chat-bubble.theirs {
    background: #fff; color: #1e2022; border: 1px solid #e8e0f0;
    align-self: flex-start; border-bottom-left-radius: 4px;
  }
  .chat-bubble .bubble-time {
    font-size: 10px; opacity: 0.6; margin-top: 3px; text-align: right;
  }
  .chat-empty {
    text-align: center; color: #aaa; font-size: 13px;
    margin: auto; padding: 20px;
  }
  .chat-footer {
    padding: 10px 12px; border-top: 1px solid #ede8f5;
    display: flex; gap: 8px; background: #fff;
  }
  #abona-chat-input {
    flex: 1; border: 1px solid #d8d0ea; border-radius: 20px;
    padding: 8px 14px; font-size: 13px; outline: none;
    font-family: inherit;
  }
  #abona-chat-input:focus { border-color: #c73060; }
  #abona-chat-send {
    background: #c73060; color: #fff; border: none;
    border-radius: 50%; width: 36px; height: 36px;
    cursor: pointer; font-size: 16px; display: flex;
    align-items: center; justify-content: center; flex-shrink: 0;
  }
  #abona-chat-send:hover { background: #a02050; }
  .chat-login-prompt {
    padding: 24px 18px; text-align: center; color: #666; font-size: 13px;
  }
  .chat-login-prompt a {
    color: #c73060; font-weight: 600; text-decoration: none;
  }
`;

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function renderBubble(msg, userId) {
  const mine = msg.sender_type === 'customer' && msg.sender_id === userId;
  const isBot = msg.is_bot || (msg.sender_type === 'admin' && msg.sender_id === 0);
  const div = document.createElement('div');
  div.className = `chat-bubble ${mine ? 'mine' : 'theirs'}`;

  // Format message: convert **bold** markdown
  const formatted = (msg.message || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

  const label = isBot ? '<span style="font-size:10px;opacity:0.7;display:block;margin-bottom:3px">🤖 Abona Bot</span>' : '';
  div.innerHTML = `${label}${formatted}<div class="bubble-time">${formatTime(msg.created_at)}</div>`;

  // Render product cards if present
  if (msg.products?.length) {
    const cards = document.createElement('div');
    cards.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px';
    msg.products.forEach(p => {
      const card = document.createElement('a');
      card.href = `product.html?id=${p.id}`;
      card.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);border-radius:8px;padding:7px 10px;text-decoration:none;color:inherit';
      card.innerHTML = `
        <img src="${p.image || ''}" style="width:36px;height:36px;border-radius:5px;object-fit:cover;background:#eee" onerror="this.style.display='none'">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
          <div style="font-size:11px;opacity:0.85">฿${(p.price_cents/100).toLocaleString()} · ⭐${p.stars||0}</div>
        </div>`;
      cards.appendChild(card);
    });
    div.appendChild(cards);
  }
  return div;
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

export async function initChat(user) {
  currentUser = user;
  injectStyles();

  // Build widget HTML
  const btn = document.createElement('button');
  btn.id = 'abona-chat-btn';
  btn.title = 'Chat with us';
  btn.innerHTML = `💬<span id="abona-chat-badge"></span>`;

  const box = document.createElement('div');
  box.id = 'abona-chat-box';

  document.body.appendChild(btn);
  document.body.appendChild(box);
  const badge = document.getElementById('abona-chat-badge');

  if (!user) {
    box.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-avatar">💬</div>
        <div class="chat-header-info">
          <div class="chat-header-name">Abona Support</div>
          <div class="chat-header-status">We usually reply within minutes</div>
        </div>
      </div>
      <div class="chat-login-prompt">
        <p>Please <a href="login.html">sign in</a> to chat with our support team.</p>
      </div>`;
    btn.addEventListener('click', () => box.classList.toggle('open'));
    return;
  }

  box.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-avatar">💬</div>
      <div class="chat-header-info">
        <div class="chat-header-name">Abona Support</div>
        <div class="chat-header-status">We usually reply within minutes</div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="chat-empty">Connecting… 💬</div>
    </div>
    <div class="chat-footer">
      <input id="abona-chat-input" type="text" placeholder="Type a message…" maxlength="500" disabled>
      <button id="abona-chat-send" disabled>➤</button>
    </div>`;

  const messagesEl = box.querySelector('#chat-messages');
  const input = box.querySelector('#abona-chat-input');
  const sendBtn = box.querySelector('#abona-chat-send');

  // Wait for socket.io script to load
  let attempts = 0;
  while (!window.io && attempts < 30) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!window.io) { console.warn('socket.io not loaded'); return; }

  // Connect using cookies for auth (no separate token fetch needed)
  socket = window.io(API_BASE, {
    withCredentials: true,
    transports: ['polling', 'websocket']
  });

  socket.on('connect', () => {
    console.log('[Chat] Socket connected! id:', socket.id);
    // Get or create conversation through the socket (avoids cross-origin cookie issue)
    socket.emit('customer:init', {}, (response) => {
      if (!response?.conversationId) {
        console.warn('[Chat] No conversation ID returned');
        return;
      }
      conversationId = response.conversationId;
      console.log('[Chat] Conversation ID:', conversationId);
      socket.emit('customer:join', conversationId);

      // Load history
      const msgs = response.messages || [];
      if (msgs.length) {
        messagesEl.innerHTML = '';
        msgs.forEach(m => messagesEl.appendChild(renderBubble(m, user.id)));
        scrollToBottom(messagesEl);
      } else {
        messagesEl.innerHTML = '<div class="chat-empty">No messages yet. Say hello! 👋</div>';
      }

      // Enable input
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    });
  });

  socket.on('connect_error', (err) => {
    console.warn('[Chat] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Chat] Disconnected:', reason);
  });

  socket.on('chat:message', (msg) => {
    console.log('[Chat] Received chat:message:', msg.sender_type, msg.message?.slice(0, 30));
    if (messagesEl.querySelector('.chat-empty')) messagesEl.innerHTML = '';
    messagesEl.appendChild(renderBubble(msg, user.id));
    scrollToBottom(messagesEl);
    if (!box.classList.contains('open') && msg.sender_type === 'admin') {
      badge.style.display = 'flex';
      badge.textContent = (parseInt(badge.textContent) || 0) + 1;
    }
  });

  // Send message
  function sendMessage() {
    const text = input.value.trim();
    if (!text || !socket) return;
    console.log('[Chat] Sending:', text, '| conv:', conversationId, '| connected:', socket.connected);
    socket.emit('customer:message', { conversationId, message: text });
    input.value = '';
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

  // Toggle open/close
  btn.addEventListener('click', () => {
    box.classList.toggle('open');
    if (box.classList.contains('open')) {
      badge.style.display = 'none';
      badge.textContent = '';
      input.focus();
      scrollToBottom(messagesEl);
    }
  });
}
