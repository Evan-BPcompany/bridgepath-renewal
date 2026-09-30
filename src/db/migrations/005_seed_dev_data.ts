import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Phase 1 Day 2: Seed development/test data (DEVELOPMENT ENVIRONMENT ONLY)
    -- WARNING: This migration is for development and testing only!
    -- In production environments, use a separate admin initialization process
    -- and do NOT use hardcoded passwords.

    -- Insert initial master admin user (DEVELOPMENT ONLY)
    -- Password: CHANGE_ME_ON_FIRST_LOGIN (bcryptjs hash with 12 rounds)
    -- Hash: $2b$12$V9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jKMm.
    -- MUST change this password on first login!

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

    -- Insert sample base prices for eyewear category (SAMPLE DATA - DEVELOPMENT ONLY)
    INSERT INTO base_prices (
      category,
      product_variant,
      base_price,
      is_active,
      description,
      created_at,
      updated_at
    ) VALUES
      ('eyewear', 'Plastic Frame', 15000, true, '[SAMPLE] Basic plastic frame estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('eyewear', 'Metal Frame', 25000, true, '[SAMPLE] Standard metal frame estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('eyewear', 'Premium Frame', 50000, true, '[SAMPLE] Premium/designer frame estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (category, product_variant) DO NOTHING;

    -- Insert sample base prices for shoes category (SAMPLE DATA - DEVELOPMENT ONLY)
    INSERT INTO base_prices (
      category,
      product_variant,
      base_price,
      is_active,
      description,
      created_at,
      updated_at
    ) VALUES
      ('shoes', 'Canvas', 20000, true, '[SAMPLE] Canvas shoe manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('shoes', 'Leather', 35000, true, '[SAMPLE] Leather shoe manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('shoes', 'Athletic', 40000, true, '[SAMPLE] Athletic shoe manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (category, product_variant) DO NOTHING;

    -- Insert sample base prices for golf products (SAMPLE DATA - DEVELOPMENT ONLY)
    INSERT INTO base_prices (
      category,
      product_variant,
      base_price,
      is_active,
      description,
      created_at,
      updated_at
    ) VALUES
      ('golf_products', 'Golf Ball', 5000, true, '[SAMPLE] Custom golf ball manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('golf_products', 'Golf Club', 150000, true, '[SAMPLE] Golf club head manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('golf_products', 'Golf Bag', 60000, true, '[SAMPLE] Golf bag manufacturing estimate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (category, product_variant) DO NOTHING;

    -- Insert sample base price for other category (SAMPLE DATA - DEVELOPMENT ONLY)
    INSERT INTO base_prices (
      category,
      product_variant,
      base_price,
      is_active,
      description,
      created_at,
      updated_at
    ) VALUES
      ('other', 'Standard', 30000, true, '[SAMPLE] Consultation-based estimate for other products', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (category, product_variant) DO NOTHING;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    -- WARNING: This rollback will delete development data
    -- Only run this in development/test environments!

    DELETE FROM base_prices WHERE description LIKE '[SAMPLE]%';
    DELETE FROM admin_users WHERE username = 'master' AND email = 'admin@bridgepath.local';
  `);
}
