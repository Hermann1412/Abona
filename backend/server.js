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

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500',
    credentials: true
  }
});

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500',
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

// Socket.io auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try {
    // Try customer token first, then admin token
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      socket.user.isAdmin = false;
    } catch {
      socket.user = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
      socket.user.isAdmin = true;
    }
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Register socket event handlers
registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/login`);
});
