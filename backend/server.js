import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payment.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';
import reviewRoutes from './routes/reviews.js';
import uploadRoutes from './routes/uploads.js';
import wishlistRoutes from './routes/wishlist.js';
import couponRoutes from './routes/coupons.js';
import chatRoutes, { registerSocketHandlers } from './routes/chat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = [
  process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500',
  'https://abona.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => cb(null, origin || true),
    credentials: true,
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: (origin, cb) => cb(null, origin || true),
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Serve uploaded files publicly
app.use('/uploads', express.static(join(__dirname, 'uploads')));
// Serve frontend product images so the admin panel can display them
app.use('/images', express.static(join(__dirname, '../frontend/images')));
// Serve favicon for admin pages
app.use('/favicon.ico', (req, res) => res.sendFile(join(__dirname, '../frontend/favicon.ico')));

// Public API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/chat', chatRoutes);
app.get('/api/config', (req, res) => res.json({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY }));

// Admin routes — HTML pages + API, all protected
app.use('/admin', adminRoutes);

// Socket.io auth middleware — reads cookie from handshake headers
io.use((socket, next) => {
  try {
    const cookies = socket.handshake.headers.cookie || '';
    const get = (name) => {
      const match = cookies.split(';').find(c => c.trim().startsWith(`${name}=`));
      return match ? match.split('=').slice(1).join('=').trim() : null;
    };

    const userToken  = get('token');
    const adminToken = get('admin_token');

    // Check admin_token first so admin sessions are never mis-classified
    // as customers when both cookies are present (e.g. testing both roles)
    if (adminToken) {
      socket.user = jwt.verify(adminToken, process.env.JWT_ADMIN_SECRET);
      socket.user.isAdmin = true;
      return next();
    }
    if (userToken) {
      socket.user = jwt.verify(userToken, process.env.JWT_SECRET);
      socket.user.isAdmin = false;
      return next();
    }
    return next(new Error('No auth cookie'));
  } catch {
    return next(new Error('Invalid token'));
  }
});

// Register socket event handlers
registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/login`);
});
