-- Phase 1 Day 2: Seed initial admin user (master account)

-- NOTE: This migration inserts a default admin user
-- Password: CHANGE_ME_ON_FIRST_LOGIN (bcryptjs hash with 12 rounds)
-- Hash generated from: bcryptjs.hashSync('CHANGE_ME_ON_FIRST_LOGIN', 12)
-- You MUST change this password on first login

INSERT INTO admin_users (
  id,
  username,
  email,
  password_hash,
  role,
  is_active,
  created_at,
  updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'master',
  'admin@bridgepath.local',
  '$2b$12$V9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jKMm.',
  'admin',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (username) DO NOTHING;

-- Insert sample base prices for eyewear category
INSERT INTO base_prices (
  category,
  product_variant,
  base_price,
  is_active,
  description,
  created_at,
  updated_at
) VALUES
  ('eyewear', 'Plastic Frame', 15000, true, 'Basic plastic frame estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('eyewear', 'Metal Frame', 25000, true, 'Standard metal frame estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('eyewear', 'Premium Frame', 50000, true, 'Premium/designer frame estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (category, product_variant) DO NOTHING;

-- Insert sample base prices for shoes category
INSERT INTO base_prices (
  category,
  product_variant,
  base_price,
  is_active,
  description,
  created_at,
  updated_at
) VALUES
  ('shoes', 'Canvas', 20000, true, 'Canvas shoe manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('shoes', 'Leather', 35000, true, 'Leather shoe manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('shoes', 'Athletic', 40000, true, 'Athletic shoe manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (category, product_variant) DO NOTHING;

-- Insert sample base prices for golf products
INSERT INTO base_prices (
  category,
  product_variant,
  base_price,
  is_active,
  description,
  created_at,
  updated_at
) VALUES
  ('golf_products', 'Golf Ball', 5000, true, 'Custom golf ball manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('golf_products', 'Golf Club', 150000, true, 'Golf club head manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('golf_products', 'Golf Bag', 60000, true, 'Golf bag manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (category, product_variant) DO NOTHING;

-- Insert sample base price for other category
INSERT INTO base_prices (
  category,
  product_variant,
  base_price,
  is_active,
  description,
  created_at,
  updated_at
) VALUES
  ('other', 'Standard', 30000, true, 'Consultation-based estimate for other products', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (category, product_variant) DO NOTHING;
