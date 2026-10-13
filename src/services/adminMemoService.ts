import { getPool } from '../config/database';

export interface MemoRecord {
  id: string;
  content: string;
  author: { id: string; username: string };
  created_at: string;
}

function iso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

// The estimate check and the insert are one statement, so a memo can never be written
// for an estimate that does not exist and there is no check-then-insert race.
export async function createMemo(input: {
  estimateId: string;
  admin: { id: string; username: string };
  content: string;
}): Promise<(MemoRecord & { estimate_id: string }) | null> {
  const pool = getPool();

  const result = await pool.query(
    `INSERT INTO admin_memos (estimate_id, admin_user_id, content)
     SELECT e.id, $2, $3 FROM estimates e WHERE e.id = $1
     RETURNING id, estimate_id, content, created_at`,
    [input.estimateId, input.admin.id, input.content]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    estimate_id: row.estimate_id,
    content: row.content,
    author: { id: input.admin.id, username: input.admin.username },
    created_at: iso(row.created_at)
  };
}

export async function listMemos(
  estimateId: string,
  paging: { page: number; limit: number }
): Promise<{ items: MemoRecord[]; total: number } | null> {
  const pool = getPool();

  const exists = await pool.query(`SELECT 1 FROM estimates WHERE id = $1`, [estimateId]);
  if (exists.rows.length === 0) {
    return null;
  }

  const offset = (paging.page - 1) * paging.limit;

  const [countResult, listResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM admin_memos WHERE estimate_id = $1`, [estimateId]),
    pool.query(
      `SELECT m.id, m.content, m.created_at, m.admin_user_id, u.username AS author_username
       FROM admin_memos m
       JOIN admin_users u ON u.id = m.admin_user_id
       WHERE m.estimate_id = $1
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $2 OFFSET $3`,
      [estimateId, paging.limit, offset]
    )
  ]);

  return {
    total: countResult.rows[0].total,
    items: listResult.rows.map(row => ({
      id: row.id,
      content: row.content,
      author: { id: row.admin_user_id, username: row.author_username },
      created_at: iso(row.created_at)
    }))
  };
}
