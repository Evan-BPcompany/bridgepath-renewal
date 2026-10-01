import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Add new columns to email_events for retry management and SendGrid tracking
    ALTER TABLE email_events
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_error VARCHAR(500),
    ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

    -- Create index for efficient pending event queries
    CREATE INDEX IF NOT EXISTS idx_email_events_next_retry
      ON email_events(next_retry_at, status)
      WHERE status IN ('pending', 'sending');

    -- Create index for updated_at to find stale sending events
    CREATE INDEX IF NOT EXISTS idx_email_events_updated_at
      ON email_events(updated_at DESC)
      WHERE status = 'sending';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Drop indexes
    DROP INDEX IF EXISTS idx_email_events_updated_at;
    DROP INDEX IF EXISTS idx_email_events_next_retry;

    -- Remove added columns
    ALTER TABLE email_events
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS provider_message_id,
    DROP COLUMN IF EXISTS last_error,
    DROP COLUMN IF EXISTS next_retry_at;
  `);
}
