import fs from 'fs';
import path from 'path';
import { MEMO_MAX_LENGTH, MEMO_MIN_LENGTH } from '../middleware/adminValidation';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const read = (file: string): string => fs.readFileSync(path.join(migrationsDir, file), 'utf8');

describe('Migration 010: admin memo content length CHECK', () => {
  const source = read('010_admin_memos_content_check.ts');
  const [upPart, downPart] = source.split('export async function down');

  it('adds a CHECK with the same 1-5000 limits the API enforces', () => {
    const match = upPart.match(/CHECK \(char_length\(content\) BETWEEN (\d+) AND (\d+)\)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(MEMO_MIN_LENGTH);
    expect(Number(match![2])).toBe(MEMO_MAX_LENGTH);
    expect(upPart).toContain('ADD CONSTRAINT admin_memos_content_length');
  });

  it('drops any previous constraint of the same name before adding it', () => {
    expect(upPart.indexOf('DROP CONSTRAINT IF EXISTS admin_memos_content_length')).toBeLessThan(
      upPart.indexOf('ADD CONSTRAINT admin_memos_content_length')
    );
  });

  it('down removes the constraint and nothing else', () => {
    expect(downPart).toContain('DROP CONSTRAINT IF EXISTS admin_memos_content_length');
    expect(downPart).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE|TRUNCATE/i);
  });

  it('documents the failure mode when existing rows violate the limit', () => {
    expect(upPart).toContain('fails if admin_memos already contains');
  });

  it('does not modify the original admin_memos table definition', () => {
    const init = read('001_init_schema.ts');
    expect(init).toContain('content TEXT NOT NULL');
    expect(init).not.toContain('admin_memos_content_length');
  });
});
