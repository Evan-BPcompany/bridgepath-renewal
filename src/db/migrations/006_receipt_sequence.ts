import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Phase 1 Day 4: Receipt sequence table for concurrency-safe ID generation
    -- Stores the last sequence number for each date
    -- Used to generate receipt IDs in format: BP + YYYYMMDD + 3-digit sequence

    CREATE TABLE IF NOT EXISTS receipt_sequence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_date DATE NOT NULL UNIQUE,
      last_sequence INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- UNIQUE constraint automatically creates index, no explicit index needed
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE IF EXISTS receipt_sequence;
  `);
}
