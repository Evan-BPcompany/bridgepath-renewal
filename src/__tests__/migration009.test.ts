import fs from 'fs';
import path from 'path';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

interface IndexDef {
  file: string;
  name: string;
  table: string;
  columns: string;
}

function readIndexes(file: string): IndexDef[] {
  const source = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const pattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)/gi;
  return [...source.matchAll(pattern)].map(m => ({
    file,
    name: m[1],
    table: m[2],
    columns: m[3].replace(/\s+/g, ' ').trim().toLowerCase()
  }));
}

describe('Migration 009: admin API indexes', () => {
  const file = '009_admin_api_indexes.ts';
  const source = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const [upPart, downPart] = source.split('export async function down');
  const earlierFiles = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.ts') && f < file)
    .sort();

  it('creates the three requested composite indexes with IF NOT EXISTS', () => {
    expect(upPart).toMatch(/CREATE INDEX IF NOT EXISTS idx_estimates_status_created_at\s+ON estimates\(status, created_at DESC\)/);
    expect(upPart).toMatch(/CREATE INDEX IF NOT EXISTS idx_status_history_estimate_created\s+ON status_history\(estimate_id, created_at DESC\)/);
    expect(upPart).toMatch(/CREATE INDEX IF NOT EXISTS idx_admin_memos_estimate_created\s+ON admin_memos\(estimate_id, created_at DESC\)/);
  });

  it('drops all three indexes with IF EXISTS in down', () => {
    expect(downPart).toContain('DROP INDEX IF EXISTS idx_estimates_status_created_at');
    expect(downPart).toContain('DROP INDEX IF EXISTS idx_status_history_estimate_created');
    expect(downPart).toContain('DROP INDEX IF EXISTS idx_admin_memos_estimate_created');
  });

  it('drops the indexes in the reverse order of their creation', () => {
    const created = [...upPart.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map(m => m[1]);
    const dropped = [...downPart.matchAll(/DROP INDEX IF EXISTS (\w+)/g)].map(m => m[1]);
    expect(dropped).toEqual([...created].reverse());
  });

  it('does not duplicate the name or the table/column combination of any earlier index', () => {
    const existing = earlierFiles.flatMap(readIndexes);
    const added = readIndexes(file);

    expect(existing.length).toBeGreaterThan(20);
    expect(added).toHaveLength(3);

    for (const index of added) {
      expect(existing.find(e => e.name === index.name)).toBeUndefined();
      expect(existing.find(e => e.table === index.table && e.columns === index.columns)).toBeUndefined();
    }
  });
});
