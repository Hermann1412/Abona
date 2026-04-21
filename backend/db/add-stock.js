import 'dotenv/config';
import pool from './connection.js';

try {
  await pool.execute(
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT NOT NULL DEFAULT -1 AFTER price_cents"
  );
  console.log('✓ stock column ready');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('✓ stock column already exists');
  } else {
    console.error('✗', e.message);
  }
}
await pool.end();
