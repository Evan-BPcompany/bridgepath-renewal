import { generateAccessToken } from '../../utils/token';

export const ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
export const MANAGER_ID = 'a0000000-0000-0000-0000-000000000002';
export const SESSION_ID = 'b0000000-0000-0000-0000-000000000001';
export const ESTIMATE_ID = 'c0000000-0000-0000-0000-000000000001';

export type Role = 'admin' | 'manager';
export type Row = Record<string, unknown>;
export type QueryResult = { rows: Row[]; rowCount?: number };
export type QueryHandler = (sql: string, params: unknown[]) => QueryResult | undefined;

export interface FakeDbState {
  mustChangePassword: boolean;
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
    mustChangePassword: false,
    sessionRevoked: false,
    sessionExpired: false,
    sessionMissing: false,
    adminInactive: false,
    queries: [],
    handler: () => undefined
  };

  const run = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    state.queries.push({ sql, params });

    // The refresh endpoint looks a session up by its refresh token hash; tests answer that themselves.
    if (sql.includes('FROM admin_sessions') && !sql.includes('s.refresh_token_hash')) {
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

    // The authentication lookup only; row-locking reads (FOR UPDATE) are left to the test handler.
    if (sql.includes('FROM admin_users WHERE id') && !sql.includes('FOR UPDATE')) {
      const isManager = params[0] === MANAGER_ID;
      return {
        rows: [
          {
            id: isManager ? MANAGER_ID : ADMIN_ID,
            username: isManager ? 'staff' : 'master',
            email: 'staff@bridgepath.local',
            role: isManager ? 'manager' : 'admin',
            is_active: !state.adminInactive,
            must_change_password: state.mustChangePassword
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
