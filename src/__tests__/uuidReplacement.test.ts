jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { generateSafeFileId } from '../utils/fileValidation';
import { ADMIN_ID, createFakeDb } from './helpers/adminTestUtils';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('crypto.randomUUID replaces the uuid package', () => {
  const root = path.join(__dirname, '..', '..');

  it('the uuid packages are no longer dependencies and no source file imports them', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.dependencies.uuid).toBeUndefined();
    expect(pkg.devDependencies['@types/uuid']).toBeUndefined();

    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          sources.push(full);
        }
      }
    };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'scripts'));

    const importing = sources.filter(file => /from ['"]uuid['"]|require\(['"]uuid['"]\)/.test(fs.readFileSync(file, 'utf8')));
    expect(importing).toEqual([]);
  });

  it('generateSafeFileId returns 32 hex characters (a v4 UUID without dashes), all different', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const id = generateSafeFileId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(id[12]).toBe('4');
      ids.add(id);
    }
    expect(ids.size).toBe(2000);
  });

  it('admin login creates a v4 UUID session id', async () => {
    const db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    const password = 'Correct-Horse-9';
    const passwordHash = bcrypt.hashSync(password, 4);
    db.state.handler = sql =>
      sql.includes('password_hash') && (sql.includes('WHERE username') || sql.includes('FOR UPDATE'))
        ? {
            rows: [
              {
                id: ADMIN_ID,
                username: 'master',
                email: 'admin@bridgepath.local',
                password_hash: passwordHash,
                role: 'admin',
                is_active: true,
                failed_login_attempts: 0,
                locked_until: null,
                must_change_password: false
              }
            ]
          }
        : undefined;

    const res = await request(createApp()).post('/admin/login').send({ username: 'master', password });
    expect(res.status).toBe(200);

    const insert = db.state.queries.find(q => q.sql.includes('INSERT INTO admin_sessions'))!;
    expect(insert.params[0]).toMatch(UUID_V4);

    jest.restoreAllMocks();
  });
});
