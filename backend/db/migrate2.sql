-- Migration 2: stock tracking + product images
USE abona_shop;

-- Add stock column to products (-1 = unlimited/not tracked, 0 = out of stock, >0 = quantity)
ALTER TABLE products
  ADD COLUMN stock INT NOT NULL DEFAULT -1 AFTER price_cents;
