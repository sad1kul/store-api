-- -------------------------------------------------------
-- Orders
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(20) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  customer_name VARCHAR(150) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  delivery_address TEXT NOT NULL,
  is_bulk_order TINYINT(1) NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) UNSIGNED NOT NULL,
  vat DECIMAL(12,2) UNSIGNED NOT NULL,
  total DECIMAL(12,2) UNSIGNED NOT NULL,
  bulk_savings DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending','processing','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  estimated_delivery DATE NULL,
  admin_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_orders_customer (customer_id),
  INDEX idx_orders_status (status),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Order Items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(20) NOT NULL,
  product_id INT UNSIGNED NULL,
  product_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  image_url VARCHAR(500) NULL,
  retail_price DECIMAL(12,2) UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) UNSIGNED NOT NULL,
  qty INT UNSIGNED NOT NULL,
  line_total DECIMAL(12,2) UNSIGNED NOT NULL,
  is_bulk_priced TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_order_items_order (order_id),
  INDEX idx_order_items_product (product_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Bulk Pricing Tiers (per product)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_pricing_tiers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id INT UNSIGNED NOT NULL,
  min_qty INT UNSIGNED NOT NULL,
  max_qty INT UNSIGNED NULL,
  price DECIMAL(12,2) UNSIGNED NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_bulk_pricing_product (product_id),
  CONSTRAINT fk_bulk_pricing_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Wholesale Applications
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS wholesale_applications (
  id VARCHAR(20) NOT NULL,
  user_id INT UNSIGNED NULL,
  business_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NULL,
  business_type VARCHAR(100) NULL,
  business_registration VARCHAR(100) NULL,
  shop_address VARCHAR(255) NULL,
  shop_city VARCHAR(100) NULL,
  shop_province VARCHAR(100) NULL,
  shop_postal_code VARCHAR(20) NULL,
  tax_number VARCHAR(50) NULL,
  monthly_order_value VARCHAR(50) NULL,
  notes TEXT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  applied_date DATE NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_date DATE NULL,
  rejected_date DATE NULL,
  rejection_reason TEXT NULL,
  admin_notes TEXT NULL,
  PRIMARY KEY (id),
  INDEX idx_wholesale_email (email),
  INDEX idx_wholesale_status (status),
  CONSTRAINT fk_wholesale_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Site Content (single-row settings table)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_content (
  id INT UNSIGNED NOT NULL DEFAULT 1,
  hero_heading VARCHAR(255) NOT NULL DEFAULT 'Welcome to Smoke Time Store',
  hero_subtext VARCHAR(500) NOT NULL DEFAULT 'Premium tobacco products delivered to your door.',
  promo_banner_text VARCHAR(255) NOT NULL DEFAULT 'Free delivery on orders over R500!',
  featured_product_ids JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO site_content (id, hero_heading, hero_subtext, promo_banner_text, featured_product_ids)
VALUES (1, 'Welcome to Smoke Time Store', 'Premium tobacco products delivered to your door.', 'Free delivery on orders over R500!', '[]');
