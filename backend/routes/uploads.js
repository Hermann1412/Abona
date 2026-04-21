import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminAPI } from '../middleware/adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

function makeStorage(subfolder) {
  return multer.diskStorage({
    destination: path.join(__dirname, '../uploads', subfolder),
    filename: (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    }
  });
}

function imageFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
}

const uploadProduct = multer({ storage: makeStorage('products'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadAvatar  = multer({ storage: makeStorage('avatars'),  fileFilter: imageFilter, limits: { fileSize: 3 * 1024 * 1024 } });

// POST /api/uploads/product — admin only
router.post('/product', requireAdminAPI, uploadProduct.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const url = `/uploads/products/${req.file.filename}`;
  res.json({ url });
});

// POST /api/uploads/avatar — any logged-in user
router.post('/avatar', verifyToken, uploadAvatar.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const url = `/uploads/avatars/${req.file.filename}`;
  res.json({ url });
});

// Error handler for multer errors
router.use((err, req, res, next) => {
  if (err.message) return res.status(400).json({ error: err.message });
  next(err);
});

export default router;
