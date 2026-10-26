import type { Knex } from 'knex';

// KakaoTalk notices (receipt, quote arrived, question answered): the consent of the customer to
// receive them, and an outbox like the one for e-mail. The consent is a column of its own, separate
// from the privacy consent: a customer may take the notices back without leaving.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE customers ADD COLUMN kakao_notify_consent_at TIMESTAMP WITH TIME ZONE;

    CREATE TABLE kakao_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,
      recipient_phone VARCHAR(20) NOT NULL,
      template_code VARCHAR(40) NOT NULL CHECK (template_code IN ('receipt', 'quote_published', 'inquiry_answered')),
      variables JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
      idempotency_key VARCHAR(255) NOT NULL UNIQUE,
      retry_count INT NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP WITH TIME ZONE,
      last_error VARCHAR(500),
      provider_message_id VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP WITH TIME ZONE
    );
    CREATE INDEX idx_kakao_events_queue ON kakao_events(next_retry_at, created_at) WHERE status = 'pending';
    CREATE INDEX idx_kakao_events_sending ON kakao_events(updated_at) WHERE status = 'sending';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE IF EXISTS kakao_events;
    ALTER TABLE customers DROP COLUMN IF EXISTS kakao_notify_consent_at;
  `);
}
