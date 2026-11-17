import type { Knex } from 'knex';

// Price evidence for the AI quote (2026-11-17): one row per public listing, retail price or real factory quote, with the
// source (URL, title, date) so that a shown range can always be traced back. Only rows with status 'approved' are used for a
// range; 'candidate' rows wait for the owner's check and 'rejected' rows are kept so that they are not collected again.
//   price_kind  listing = a public sourcing listing price (a reference, not a quote)
//               quote   = a real quote from a factory (the source URL may be empty: it came by mail)
//               retail  = a shop price (a reference for the market, never an OEM price)
// The table is new: no existing table or row changes. The AI quote does not read it yet.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE price_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category VARCHAR(40) NOT NULL,
      product_type VARCHAR(40) NOT NULL,
      region VARCHAR(10) NOT NULL CHECK (region IN ('overseas', 'domestic')),
      price_kind VARCHAR(10) NOT NULL CHECK (price_kind IN ('listing', 'quote', 'retail')),
      price_min NUMERIC(12, 2) NOT NULL CHECK (price_min > 0),
      price_max NUMERIC(12, 2) NOT NULL,
      currency CHAR(3) NOT NULL CHECK (currency IN ('USD', 'KRW', 'CNY')),
      unit VARCHAR(20) NOT NULL DEFAULT 'pair',
      moq INT CHECK (moq > 0),
      trade_terms VARCHAR(20),
      upper_material VARCHAR(40),
      outsole VARCHAR(40),
      closure VARCHAR(40),
      supplier_name VARCHAR(200),
      supplier_type VARCHAR(10) NOT NULL DEFAULT 'unknown' CHECK (supplier_type IN ('factory', 'trading', 'unknown')),
      source_url VARCHAR(2000),
      source_title VARCHAR(300) NOT NULL,
      price_date DATE,
      collected_at DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected')),
      approved_at TIMESTAMP WITH TIME ZONE,
      note VARCHAR(500),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT price_evidence_range CHECK (price_max >= price_min),
      CONSTRAINT price_evidence_source CHECK (price_kind = 'quote' OR source_url IS NOT NULL),
      CONSTRAINT price_evidence_approved CHECK (status <> 'approved' OR approved_at IS NOT NULL)
    );
    CREATE UNIQUE INDEX uq_price_evidence_source
      ON price_evidence (price_kind, (COALESCE(source_url, '')), source_title, collected_at);
    CREATE INDEX idx_price_evidence_lookup ON price_evidence (category, region, status);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS price_evidence');
}
