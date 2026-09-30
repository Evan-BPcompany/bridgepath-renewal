// ⚠️ Temporary types for Day 1 - Will be integrated with DB schema in Day 2

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'manager';
  password_hash: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AdminSession {
  id: string;
  admin_user_id: string;
  refresh_token_hash: string;
  is_revoked: boolean;
  device_info?: string;
  ip_address?: string;
  last_activity_at: Date;
  created_at: Date;
  expires_at: Date;
}

export interface Estimate {
  id: string;
  receipt_id: string;
  category: 'eyewear' | 'shoes' | 'golf_products' | 'other';
  status: string;
  customer_email: string;
  customer_phone: string;
  specification_json: Record<string, unknown>;
  is_consultation: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EstimateAccessToken {
  id: string;
  estimate_id: string;
  receipt_id: string;
  token: string;
  is_used: boolean;
  visited_at?: Date;
  created_at: Date;
  expires_at: Date;
}

export interface File {
  id: string;
  estimate_id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  s3_key: string;
  file_status: 'quarantine' | 'pending_scan' | 'approved' | 'rejected';
  virus_scan_status: 'pending' | 'passed' | 'failed';
  virus_scan_result?: string;
  uploaded_at: Date;
  scanned_at?: Date;
}

export interface BasePrice {
  id: string;
  category: 'eyewear' | 'shoes' | 'golf_products' | 'other';
  product_variant: string;
  base_price: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmailEvent {
  id: string;
  recipient_email: string;
  email_type: string;
  estimate_id?: string;
  subject: string;
  body: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  idempotency_key: string;
  retry_count: number;
  last_retry_at?: Date;
  created_at: Date;
  sent_at?: Date;
}

export interface Quotation {
  id: string;
  estimate_id: string;
  pdf_file_id: string;
  status: 'draft' | 'sent' | 'reviewed' | 'confirmed';
  created_at: Date;
  updated_at: Date;
}

export interface StatusHistory {
  id: string;
  estimate_id: string;
  old_status: string;
  new_status: string;
  changed_by?: string;
  reason?: string;
  created_at: Date;
}

export interface AdminMemo {
  id: string;
  estimate_id: string;
  admin_user_id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}
