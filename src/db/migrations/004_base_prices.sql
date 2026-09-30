-- Phase 1 Day 2: Base prices for product categories

CREATE TABLE IF NOT EXISTS base_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(50) NOT NULL CHECK (category IN ('eyewear', 'shoes', 'golf_products', 'other')),
  product_variant VARCHAR(100) NOT NULL,
  base_price DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'KRW',
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category, product_variant)
);

-- email_events table (related to base prices and quotations workflow)
CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email VARCHAR(100) NOT NULL,
  email_type VARCHAR(50) NOT NULL CHECK (email_type IN ('receipt', 'quotation', 'admin_notification', 'status_update')),
  estimate_id UUID REFERENCES estimates(id),
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  retry_count INT DEFAULT 0,
  last_retry_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for base prices and email events
CREATE INDEX idx_base_prices_category ON base_prices(category);
CREATE INDEX idx_base_prices_is_active ON base_prices(is_active);
CREATE INDEX idx_email_events_status ON email_events(status);
CREATE INDEX idx_email_events_recipient_email ON email_events(recipient_email);
CREATE INDEX idx_email_events_estimate_id ON email_events(estimate_id);
CREATE INDEX idx_email_events_idempotency_key ON email_events(idempotency_key);
CREATE INDEX idx_email_events_created_at ON email_events(created_at DESC);
