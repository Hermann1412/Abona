import jwt from 'jsonwebtoken';

// Used for admin API routes — returns 401/403 JSON
export function requireAdminAPI(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  try {
    req.admin = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired admin session' });
  }
}

// Used for admin HTML page routes — redirects to login page
export function requireAdminPage(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) {
    return res.redirect('/admin/login');
  }
  try {
    req.admin = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
    next();
  } catch {
    return res.redirect('/admin/login');
  }
}
