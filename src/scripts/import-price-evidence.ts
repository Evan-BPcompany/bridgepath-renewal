import 'dotenv/config';
import * as fs from 'fs';
import { Pool } from 'pg';
import { parseEvidenceFile, storeEvidence } from '../utils/priceEvidence';

// `npm run evidence:import -- <file.json> [--apply]`
// Reads a JSON file of price evidence rows and checks every row. Without --apply nothing is written: it only reports what would be
// stored. With --apply the rows marked "approved" are stored in price_evidence (one transaction: all or none). Only DATABASE_URL is needed.
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file) {
    process.stderr.write('Usage: npm run evidence:import -- <file.json> [--apply]\n');
    return 1;
  }

  const result = parseEvidenceFile(fs.readFileSync(file, 'utf8'));
  for (const problem of result.problems) {
    process.stderr.write(`${problem}\n`);
  }
  process.stdout.write(`approved and valid: ${result.approved.length}; valid but not approved (skipped): ${result.skipped}; invalid: ${result.problems.length}\n`);
  if (result.problems.length > 0) {
    process.stderr.write('Nothing was stored: fix the invalid rows first.\n');
    return 1;
  }
  if (!apply) {
    process.stdout.write('Dry run: nothing was stored. Add --apply to store the approved rows.\n');
    return 0;
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 1;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { stored, duplicates } = await storeEvidence(client, result.approved);
    await client.query('COMMIT');
    process.stdout.write(`stored: ${stored}; already there: ${duplicates}\n`);
    return 0;
  } catch (error) {
    await client.query('ROLLBACK');
    process.stderr.write(`Nothing was stored: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then(code => {
    process.exitCode = code;
  })
  .catch(() => {
    process.exitCode = 1;
  });
