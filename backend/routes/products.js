import express from 'express';
import pool from '../db/connection.js';

const router = express.Router();

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let rows;

    if (q) {
      const term = `%${q}%`;
      [rows] = await pool.execute(
        `SELECT * FROM products
         WHERE name LIKE ?
         OR JSON_SEARCH(keywords, 'one', ?, NULL, '$[*]') IS NOT NULL
         ORDER BY name`,
        [term, q]
      );
    } else {
      [rows] = await pool.execute('SELECT * FROM products ORDER BY name');
    }

    // Map DB columns to the shape the frontend already expects
    const products = rows.map(p => ({
      id: p.id,
      name: p.name,
      image: p.image,
      priceCents: p.price_cents,
      stock: p.stock ?? -1,
      rating: { stars: parseFloat(p.stars), count: p.rating_count },
      type: p.type || undefined,
      sizeChartLink: p.size_chart || undefined,
      keywords: p.keywords || []
    }));

    return res.json(products);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    const p = rows[0];

    // Fetch extra images
    const [imgRows] = await pool.execute(
      'SELECT url, alt_text, is_primary, sort_order FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC',
      [p.id]
    );

    return res.json({
      id: p.id,
      name: p.name,
      image: p.image,
      images: imgRows,
      priceCents: p.price_cents,
      stock: p.stock ?? -1,
      rating: { stars: parseFloat(p.stars), count: p.rating_count },
      type: p.type || undefined,
      sizeChartLink: p.size_chart || undefined,
      keywords: p.keywords || [],
      description: p.description || undefined
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
