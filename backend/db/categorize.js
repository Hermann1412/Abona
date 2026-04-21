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

async function categorize() {
  const conn = await pool.getConnection();
  try {
    let updated = 0;
    for (const p of products) {
      const [result] = await conn.execute(
        `UPDATE products SET type = ?, size_chart = ?, keywords = ? WHERE id = ?`,
        [p.type || null, p.sizeChartLink || null, JSON.stringify(p.keywords || []), p.id]
      );
      if (result.affectedRows > 0) updated++;
    }
    console.log(`Done. Updated ${updated}/${products.length} products.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

categorize().catch(console.error);
