-- Phase 1 Day 2: Initial schema for Bridge Path MVP

-- admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  is_active BOOLEAN DEFAULT true,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- estimates table
CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id VARCHAR(50) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('eyewear', 'shoes', 'golf_products', 'other')),
  customer_name VARCHAR(100),
  customer_email VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20),
  company_name VARCHAR(100),
  specification_json JSONB NOT NULL,
  is_consultation BOOLEAN DEFAULT false,
  status VARCHAR(50) NOT NULL DEFAULT 'new_receipt' CHECK (status IN (
    'new_receipt', 'under_review', 'quoted', 'negotiating', 'accepted',
    'completed', 'cancelled', 'rejected', 'on_hold', 'archived'
  )),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- files table
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  file_status VARCHAR(50) NOT NULL DEFAULT 'quarantine' CHECK (file_status IN ('quarantine', 'pending_scan', 'approved', 'rejected')),
  virus_scan_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (virus_scan_status IN ('pending', 'passed', 'failed')),
  virus_scan_result TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scanned_at TIMESTAMP WITH TIME ZONE
);

-- quotations table
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL UNIQUE REFERENCES estimates(id) ON DELETE CASCADE,
  pdf_file_id UUID NOT NULL REFERENCES files(id),
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'reviewed', 'confirmed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- status_history table
CREATE TABLE IF NOT EXISTS status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  changed_by UUID REFERENCES admin_users(id),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- admin_memos table
CREATE TABLE IF NOT EXISTS admin_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_estimates_receipt_id ON estimates(receipt_id);
CREATE INDEX idx_estimates_category ON estimates(category);
CREATE INDEX idx_estimates_status ON estimates(status);
CREATE INDEX idx_estimates_created_at ON estimates(created_at DESC);
CREATE INDEX idx_files_estimate_id ON files(estimate_id);
CREATE INDEX idx_files_file_status ON files(file_status);
CREATE INDEX idx_quotations_estimate_id ON quotations(estimate_id);
CREATE INDEX idx_status_history_estimate_id ON status_history(estimate_id);
CREATE INDEX idx_admin_memos_estimate_id ON admin_memos(estimate_id);
CREATE INDEX idx_admin_users_username ON admin_users(username);
CREATE INDEX idx_admin_users_email ON admin_users(email);
