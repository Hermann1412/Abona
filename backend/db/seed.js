import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const products = JSON.parse(
  readFileSync(join(__dirname, '../products.json'), 'utf8')
);

async function seed() {
  const conn = await pool.getConnection();
  try {
    console.log(`Seeding ${products.length} products...`);

    for (const p of products) {
      await conn.execute(
        `INSERT INTO products (id, name, image, price_cents, stars, rating_count, type, size_chart, keywords)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           price_cents = VALUES(price_cents),
           stars = VALUES(stars),
           rating_count = VALUES(rating_count)`,
        [
          p.id,
          p.name,
          p.image,
          p.priceCents,
          p.rating.stars,
          p.rating.count,
          p.type || null,
          p.sizeChartLink || null,
          JSON.stringify(p.keywords || [])
        ]
      );
    }

    console.log('Seed complete.');
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch(console.error);
