-- Migration: fix products table + convert prices USD → THB (1 USD = 32 THB)
USE abona_shop;

ALTER TABLE products
  ADD COLUMN image       VARCHAR(512) DEFAULT NULL AFTER slug,
  ADD COLUMN price_cents INT          DEFAULT NULL AFTER image;

-- Copy base_price_cents into price_cents and convert USD → THB (multiply by 32)
UPDATE products SET price_cents = base_price_cents * 32 WHERE price_cents IS NULL;

-- Also update base_price_cents to THB
UPDATE products SET base_price_cents = base_price_cents * 32 WHERE base_price_cents > 0;

-- Make slug nullable (seed doesn't provide it)
ALTER TABLE products MODIFY COLUMN slug VARCHAR(512) DEFAULT NULL;

-- Replace US tax rates with Thailand VAT
DELETE FROM tax_rates;
INSERT INTO tax_rates (country, state, rate, label) VALUES ('TH', NULL, 0.0700, 'Thailand VAT');
