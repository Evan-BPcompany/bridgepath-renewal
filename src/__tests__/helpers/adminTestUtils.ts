import { generateAccessToken } from '../../utils/token';

export const ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
export const MANAGER_ID = 'a0000000-0000-0000-0000-000000000002';
export const SESSION_ID = 'b0000000-0000-0000-0000-000000000001';
export const ESTIMATE_ID = 'c0000000-0000-0000-0000-000000000001';

export type Role = 'admin' | 'manager';
export type Row = Record<string, unknown>;
export type QueryHandler = (sql: string, params: unknown[]) => { rows: Row[] } | undefined;

export interface FakeDbState {
  sessionRevoked: boolean;
  sessionExpired: boolean;
  sessionMissing: boolean;
  adminInactive: boolean;
  queries: Array<{ sql: string; params: unknown[] }>;
  handler: QueryHandler;
}

export function createFakeDb(): {
  state: FakeDbState;
  pool: { query: jest.Mock; connect: jest.Mock };
  client: { query: jest.Mock; release: jest.Mock };
} {
  const state: FakeDbState = {
    sessionRevoked: false,
    sessionExpired: false,
    sessionMissing: false,
    adminInactive: false,
    queries: [],
    handler: () => undefined
  };

  const run = async (sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> => {
    state.queries.push({ sql, params });

    if (sql.includes('FROM admin_sessions')) {
      if (state.sessionMissing) {
        return { rows: [] };
      }
      return {
        rows: [
          {
            is_revoked: state.sessionRevoked,
            expires_at: new Date(Date.now() + (state.sessionExpired ? -60_000 : 3_600_000))
          }
        ]
      };
    }

    if (sql.includes('FROM admin_users WHERE id')) {
      const isManager = params[0] === MANAGER_ID;
      return {
        rows: [
          {
            id: isManager ? MANAGER_ID : ADMIN_ID,
            username: isManager ? 'staff' : 'master',
            email: 'staff@bridgepath.local',
            role: isManager ? 'manager' : 'admin',
            is_active: !state.adminInactive
          }
        ]
      };
    }

    const custom = state.handler(sql, params);
    return custom ?? { rows: [] };
  };

  const client = { query: jest.fn(run), release: jest.fn() };
  const pool = { query: jest.fn(run), connect: jest.fn(async () => client) };

  return { state, pool, client };
}

export function authCookie(role: Role): string {
  const adminId = role === 'admin' ? ADMIN_ID : MANAGER_ID;
  return `access_token=${generateAccessToken(adminId, SESSION_ID, role)}`;
}

export function sqlOf(state: FakeDbState): string[] {
  return state.queries.map(q => q.sql);
}
