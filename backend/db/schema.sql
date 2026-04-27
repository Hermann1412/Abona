-- =============================================================================
-- Abona Shop — Complete E-Commerce Database Schema
-- Run: mysql -u root -p < db/schema.sql
-- =============================================================================

CREATE DATABASE IF NOT EXISTS abona_shop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE abona_shop;

-- =============================================================================
-- 1. USERS & AUTH
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255)  NOT NULL,
  email           VARCHAR(255)  NOT NULL,
  password        VARCHAR(255)  NOT NULL,
  phone           VARCHAR(20)   DEFAULT NULL,
  avatar_url      VARCHAR(512)  DEFAULT NULL,
  role            ENUM('user','admin') DEFAULT 'user',
  email_verified  BOOLEAN       DEFAULT FALSE,
  is_active       BOOLEAN       DEFAULT TRUE,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  INDEX idx_users_role (role)
);

-- Refresh token / "remember me" sessions — allows logout-all-devices
CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(64)  PRIMARY KEY,
  user_id     INT          NOT NULL,
  user_agent  VARCHAR(512) DEFAULT NULL,
  ip_address  VARCHAR(45)  DEFAULT NULL,
  expires_at  TIMESTAMP    NOT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expires (expires_at)
);

-- Saved shipping/billing addresses per user
CREATE TABLE IF NOT EXISTS addresses (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  label       VARCHAR(100) DEFAULT 'Home',
  full_name   VARCHAR(255) NOT NULL,
  phone       VARCHAR(20)  DEFAULT NULL,
  line1       VARCHAR(255) NOT NULL,
  line2       VARCHAR(255) DEFAULT NULL,
  city        VARCHAR(100) NOT NULL,
  state       VARCHAR(100) DEFAULT NULL,
  postal_code VARCHAR(20)  NOT NULL,
  country     VARCHAR(100) NOT NULL DEFAULT 'TH',
  is_default  BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_addresses_user (user_id)
);

-- =============================================================================
-- 2. PRODUCT CATALOG
-- =============================================================================

-- Self-referencing for parent → child categories (e.g. Clothing > Men's > Shirts)
CREATE TABLE IF NOT EXISTS categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NOT NULL,
  parent_id   INT          DEFAULT NULL,
  image_url   VARCHAR(512) DEFAULT NULL,
  sort_order  INT          DEFAULT 0,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_slug (slug),
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_categories_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS brands (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NOT NULL,
  logo_url    VARCHAR(512) DEFAULT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_brands_slug (slug)
);

CREATE TABLE IF NOT EXISTS products (
  id              VARCHAR(36)  PRIMARY KEY,
  name            VARCHAR(512) NOT NULL,
  slug            VARCHAR(512) NOT NULL,
  description     TEXT         DEFAULT NULL,
  brand_id        INT          DEFAULT NULL,
  base_price_cents INT         NOT NULL,
  compare_price_cents INT      DEFAULT NULL,  -- original price for "was $X, now $Y"
  stars           DECIMAL(3,2) DEFAULT 0.00,  -- denormalised avg, updated by trigger/app
  rating_count    INT          DEFAULT 0,
  type            VARCHAR(50)  DEFAULT NULL,
  size_chart      VARCHAR(512) DEFAULT NULL,
  keywords        JSON         DEFAULT NULL,
  is_active       BOOLEAN      DEFAULT TRUE,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_products_slug (slug),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  INDEX idx_products_active (is_active),
  FULLTEXT INDEX ft_products_name (name)
);

-- Many-to-many: one product can be in many categories
CREATE TABLE IF NOT EXISTS product_categories (
  product_id  VARCHAR(36) NOT NULL,
  category_id INT         NOT NULL,
  PRIMARY KEY (product_id, category_id),
  FOREIGN KEY (product_id)  REFERENCES products(id)   ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Multiple images per product; one marked is_primary
CREATE TABLE IF NOT EXISTS product_images (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  product_id  VARCHAR(36)  NOT NULL,
  url         VARCHAR(512) NOT NULL,
  alt_text    VARCHAR(255) DEFAULT NULL,
  is_primary  BOOLEAN      DEFAULT FALSE,
  sort_order  INT          DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_images_product (product_id)
);

-- SKU-level variants (size + color), each with own stock and optional price override
CREATE TABLE IF NOT EXISTS product_variants (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  product_id   VARCHAR(36)  NOT NULL,
  sku          VARCHAR(100) DEFAULT NULL,
  size         VARCHAR(50)  DEFAULT NULL,
  color        VARCHAR(50)  DEFAULT NULL,
  price_cents  INT          DEFAULT NULL,   -- NULL = use product.base_price_cents
  stock        INT          NOT NULL DEFAULT 0,
  low_stock_threshold INT   DEFAULT 5,
  is_active    BOOLEAN      DEFAULT TRUE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_variant_sku (sku),
  INDEX idx_variants_product (product_id),
  INDEX idx_variants_stock (stock)
);

-- =============================================================================
-- 3. DELIVERY OPTIONS  (replaces hardcoded JS values)
-- =============================================================================

CREATE TABLE IF NOT EXISTS delivery_options (
  id            VARCHAR(10)  PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  delivery_days INT          NOT NULL,
  price_cents   INT          NOT NULL DEFAULT 0,
  is_active     BOOLEAN      DEFAULT TRUE
);

INSERT IGNORE INTO delivery_options (id, name, description, delivery_days, price_cents) VALUES
  ('1', 'Free Shipping',     'Estimated 7 business days', 7, 0),
  ('2', 'Standard Shipping', 'Estimated 3 business days', 3, 499),
  ('3', 'Express Shipping',  'Estimated 1 business day',  1, 999);

-- =============================================================================
-- 4. COUPONS  (must exist before orders)
-- =============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  code              VARCHAR(50)    NOT NULL,
  description       VARCHAR(255)   DEFAULT NULL,
  type              ENUM('percentage','fixed') NOT NULL,
  value             DECIMAL(10,2)  NOT NULL,     -- 20 = 20% off OR $20 off
  min_order_cents   INT            DEFAULT 0,
  max_uses          INT            DEFAULT NULL, -- NULL = unlimited
  uses_count        INT            DEFAULT 0,
  max_uses_per_user INT            DEFAULT 1,
  expires_at        DATETIME       DEFAULT NULL,
  is_active         BOOLEAN        DEFAULT TRUE,
  created_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupons_code (code)
);

-- =============================================================================
-- 5. ORDERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id              VARCHAR(36)  PRIMARY KEY,
  user_id         INT          NOT NULL,
  coupon_id       INT          DEFAULT NULL,

  -- Address snapshot (frozen at order time — user may change address later)
  shipping_name        VARCHAR(255) NOT NULL,
  shipping_phone       VARCHAR(20)  DEFAULT NULL,
  shipping_line1       VARCHAR(255) NOT NULL,
  shipping_line2       VARCHAR(255) DEFAULT NULL,
  shipping_city        VARCHAR(100) NOT NULL,
  shipping_state       VARCHAR(100) DEFAULT NULL,
  shipping_postal_code VARCHAR(20)  NOT NULL,
  shipping_country     VARCHAR(100) NOT NULL DEFAULT 'TH',

  -- Financials
  subtotal_cents  INT  NOT NULL,
  shipping_cents  INT  NOT NULL DEFAULT 0,
  discount_cents  INT  NOT NULL DEFAULT 0,
  tax_cents       INT  NOT NULL DEFAULT 0,
  total_cents     INT  NOT NULL,

  -- Status
  status          ENUM('pending','paid','processing','shipped','delivered','cancelled','refunded')
                  DEFAULT 'pending',
  notes           TEXT         DEFAULT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)   REFERENCES users(id),
  FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL,
  INDEX idx_orders_user   (user_id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_date   (created_at)
);

CREATE TABLE IF NOT EXISTS order_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  order_id           VARCHAR(36)  NOT NULL,
  product_id         VARCHAR(36)  NOT NULL,
  variant_id         INT          DEFAULT NULL,

  -- Snapshots — product data frozen at purchase time
  product_name       VARCHAR(512) NOT NULL,
  product_image      VARCHAR(512) NOT NULL,
  variant_size       VARCHAR(50)  DEFAULT NULL,
  variant_color      VARCHAR(50)  DEFAULT NULL,

  price_cents        INT          NOT NULL,
  quantity           INT          NOT NULL,
  delivery_option_id VARCHAR(10)  DEFAULT '1',

  FOREIGN KEY (order_id)  REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order_items_order   (order_id),
  INDEX idx_order_items_product (product_id)
);

-- Full audit log — every status change is recorded
CREATE TABLE IF NOT EXISTS order_status_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_id    VARCHAR(36)  NOT NULL,
  from_status VARCHAR(50)  DEFAULT NULL,
  to_status   VARCHAR(50)  NOT NULL,
  note        TEXT         DEFAULT NULL,
  changed_by  INT          DEFAULT NULL,  -- admin user_id, NULL if system
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)  ON DELETE SET NULL,
  INDEX idx_status_logs_order (order_id)
);

-- =============================================================================
-- 6. PAYMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS payments (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  order_id                  VARCHAR(36)  NOT NULL,
  user_id                   INT          NOT NULL,
  stripe_payment_intent_id  VARCHAR(100) DEFAULT NULL,
  stripe_charge_id          VARCHAR(100) DEFAULT NULL,
  amount_cents              INT          NOT NULL,
  currency                  VARCHAR(10)  DEFAULT 'usd',
  status                    ENUM('pending','succeeded','failed','refunded','partially_refunded')
                            DEFAULT 'pending',
  payment_method            VARCHAR(50)  DEFAULT NULL,  -- 'card', 'paypal'
  card_last4                VARCHAR(4)   DEFAULT NULL,
  card_brand                VARCHAR(20)  DEFAULT NULL,  -- 'visa', 'mastercard'
  refunded_amount_cents     INT          DEFAULT 0,
  failure_message           TEXT         DEFAULT NULL,
  created_at                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_intent (stripe_payment_intent_id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_payments_order  (order_id),
  INDEX idx_payments_status (status)
);

-- =============================================================================
-- 7. RETURNS & REFUNDS
-- =============================================================================

CREATE TABLE IF NOT EXISTS returns (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  order_id        VARCHAR(36)  NOT NULL,
  user_id         INT          NOT NULL,
  reason          TEXT         NOT NULL,
  status          ENUM('requested','approved','rejected','received','refunded')
                  DEFAULT 'requested',
  refund_cents    INT          DEFAULT 0,
  admin_notes     TEXT         DEFAULT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_returns_order  (order_id),
  INDEX idx_returns_status (status)
);

CREATE TABLE IF NOT EXISTS return_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  return_id     INT NOT NULL,
  order_item_id INT NOT NULL,
  quantity      INT NOT NULL,
  reason        TEXT DEFAULT NULL,
  FOREIGN KEY (return_id)     REFERENCES returns(id)     ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);

-- =============================================================================
-- 8. REVIEWS
-- =============================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  product_id   VARCHAR(36)  NOT NULL,
  user_id      INT          NOT NULL,
  order_id     VARCHAR(36)  DEFAULT NULL,   -- links to a verified purchase
  stars        TINYINT      NOT NULL,
  title        VARCHAR(255) DEFAULT NULL,
  body         TEXT         DEFAULT NULL,
  is_verified  BOOLEAN      DEFAULT FALSE,  -- TRUE if order_id is set
  is_approved  BOOLEAN      DEFAULT TRUE,
  helpful_count INT         DEFAULT 0,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_one_review_per_user_product (user_id, product_id),
  CHECK (stars BETWEEN 1 AND 5),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE SET NULL,
  INDEX idx_reviews_product  (product_id),
  INDEX idx_reviews_approved (is_approved)
);

-- =============================================================================
-- 9. COUPON USAGE TRACKING
-- =============================================================================

CREATE TABLE IF NOT EXISTS coupon_uses (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  coupon_id   INT         NOT NULL,
  user_id     INT         NOT NULL,
  order_id    VARCHAR(36) NOT NULL,
  used_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (coupon_id) REFERENCES coupons(id),
  FOREIGN KEY (user_id)   REFERENCES users(id),
  FOREIGN KEY (order_id)  REFERENCES orders(id),
  INDEX idx_coupon_uses_coupon (coupon_id),
  INDEX idx_coupon_uses_user   (user_id)
);

-- =============================================================================
-- 10. WISHLISTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS wishlists (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  name        VARCHAR(255) DEFAULT 'My Wishlist',
  is_public   BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_wishlists_user (user_id)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  wishlist_id  INT         NOT NULL,
  product_id   VARCHAR(36) NOT NULL,
  variant_id   INT         DEFAULT NULL,
  added_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wishlist_product_variant (wishlist_id, product_id, variant_id),
  FOREIGN KEY (wishlist_id) REFERENCES wishlists(id)         ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES products(id)          ON DELETE CASCADE,
  FOREIGN KEY (variant_id)  REFERENCES product_variants(id)  ON DELETE SET NULL
);

-- =============================================================================
-- 11. CART
-- =============================================================================

CREATE TABLE IF NOT EXISTS cart_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT          NOT NULL,
  product_id         VARCHAR(36)  NOT NULL,
  variant_id         INT          DEFAULT NULL,
  quantity           INT          DEFAULT 1,
  delivery_option_id VARCHAR(10)  DEFAULT '1',
  added_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_user_product_variant (user_id, product_id, variant_id),
  FOREIGN KEY (user_id)            REFERENCES users(id)            ON DELETE CASCADE,
  FOREIGN KEY (variant_id)         REFERENCES product_variants(id) ON DELETE SET NULL,
  FOREIGN KEY (delivery_option_id) REFERENCES delivery_options(id),
  INDEX idx_cart_user (user_id)
);

-- =============================================================================
-- 12. TAX RATES
-- =============================================================================

CREATE TABLE IF NOT EXISTS tax_rates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  country     VARCHAR(100)   NOT NULL,
  state       VARCHAR(100)   DEFAULT NULL,
  rate        DECIMAL(6,4)   NOT NULL,   -- e.g. 0.0825 = 8.25%
  label       VARCHAR(100)   DEFAULT 'Tax',
  is_active   BOOLEAN        DEFAULT TRUE,
  UNIQUE KEY uq_tax_country_state (country, state)
);

INSERT IGNORE INTO tax_rates (country, state, rate, label) VALUES
  ('TH', NULL, 0.0700, 'Thailand VAT');

-- =============================================================================
-- 13. NOTIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  type        VARCHAR(100) NOT NULL,   -- 'order_shipped', 'review_approved', etc.
  title       VARCHAR(255) NOT NULL,
  body        TEXT         DEFAULT NULL,
  link        VARCHAR(512) DEFAULT NULL,
  is_read     BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user     (user_id),
  INDEX idx_notifications_unread   (user_id, is_read),
  INDEX idx_notifications_created  (created_at)
);

-- =============================================================================
-- TRIGGERS
-- Auto-update products.stars and products.rating_count when a review is saved
-- =============================================================================

DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_review_after_insert
AFTER INSERT ON reviews
FOR EACH ROW
BEGIN
  UPDATE products
  SET stars        = (SELECT ROUND(AVG(stars), 2) FROM reviews WHERE product_id = NEW.product_id AND is_approved = TRUE),
      rating_count = (SELECT COUNT(*)              FROM reviews WHERE product_id = NEW.product_id AND is_approved = TRUE)
  WHERE id = NEW.product_id;
END$$

CREATE TRIGGER IF NOT EXISTS trg_review_after_update
AFTER UPDATE ON reviews
FOR EACH ROW
BEGIN
  UPDATE products
  SET stars        = (SELECT ROUND(AVG(stars), 2) FROM reviews WHERE product_id = NEW.product_id AND is_approved = TRUE),
      rating_count = (SELECT COUNT(*)              FROM reviews WHERE product_id = NEW.product_id AND is_approved = TRUE)
  WHERE id = NEW.product_id;
END$$

CREATE TRIGGER IF NOT EXISTS trg_review_after_delete
AFTER DELETE ON reviews
FOR EACH ROW
BEGIN
  UPDATE products
  SET stars        = IFNULL((SELECT ROUND(AVG(stars), 2) FROM reviews WHERE product_id = OLD.product_id AND is_approved = TRUE), 0),
      rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = OLD.product_id AND is_approved = TRUE)
  WHERE id = OLD.product_id;
END$$

-- Auto-log every order status change
CREATE TRIGGER IF NOT EXISTS trg_order_status_log
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
  IF OLD.status <> NEW.status THEN
    INSERT INTO order_status_logs (order_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
END$$

-- Increment coupon uses_count when a coupon_use row is inserted
CREATE TRIGGER IF NOT EXISTS trg_coupon_use_after_insert
AFTER INSERT ON coupon_uses
FOR EACH ROW
BEGIN
  UPDATE coupons SET uses_count = uses_count + 1 WHERE id = NEW.coupon_id;
END$$

DELIMITER ;

CREATE TABLE IF NOT EXISTS password_resets (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NOT NULL,
  token     VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  status     ENUM('open','closed') DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_type     ENUM('customer','admin') NOT NULL,
  sender_id       INT NOT NULL,
  message         TEXT NOT NULL,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
