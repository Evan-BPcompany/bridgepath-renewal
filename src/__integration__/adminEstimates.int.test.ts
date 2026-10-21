jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { hashEstimateToken } from '../utils/token';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import {
  MASTER_ID,
  MASTER_USERNAME,
  PASSWORD,
  Session,
  createTestApp,
  insertAdmin,
  insertEstimate,
  login,
  resetData
} from './helpers/fixtures';

// The admin API on a real PostgreSQL: list filters and search, detail, status changes with
// row locking, and memos. The queries run unchanged against the real tables.
describeIntegration('admin estimates on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;
  let admin: Session;
  let manager: Session;
  let managerId: string;

  const get = (path: string, session = admin) => request(app).get(path).set('Cookie', session.cookie);
  const patchStatus = (id: string, body: Record<string, unknown>, session = admin) =>
    request(app).patch(`/admin/estimates/${id}/status`).set('Cookie', session.cookie).send(body);
  const postMemo = (id: string, content: unknown, session = admin) =>
    request(app).post(`/admin/estimates/${id}/memos`).set('Cookie', session.cookie).send({ content });
  const receiptsOf = (res: request.Response) => res.body.data.map((item: { receipt_id: string }) => item.receipt_id);
  const history = (estimateId: string) =>
    suite().db('status_history').where({ estimate_id: estimateId }).orderBy('created_at').orderBy('id');

  beforeEach(async () => {
    await resetData(suite().db);
    managerId = await insertAdmin(suite().db, { username: 'staff', role: 'manager' });
    app = createTestApp();
    admin = await login(app, MASTER_USERNAME, PASSWORD);
    manager = await login(app, 'staff', PASSWORD);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list', () => {
    beforeEach(async () => {
      const db = suite().db;
      await insertEstimate(db, { receipt_id: 'BP20261001001', category: 'shoes', status: 'new_receipt', company_name: 'Acme 100% Co', customer_name: 'Kim Minsu', customer_email: 'kim@example.com', created_at: '2026-10-01T03:00:00Z' });
      await insertEstimate(db, { receipt_id: 'BP20261002001', category: 'eyewear', status: 'quoted', company_name: 'Optic_Plus', customer_name: 'Lee', customer_email: null, customer_phone: '010-9876-5432', created_at: '2026-10-02T03:00:00Z' });
      await insertEstimate(db, { receipt_id: 'BP20261003001', category: 'golf_products', status: 'completed', company_name: 'Fairway', customer_name: 'Park', customer_email: 'park@golf.test', created_at: '2026-10-03T03:00:00Z' });
      await insertEstimate(db, { receipt_id: 'BP20261003002', category: 'shoes', status: 'under_review', company_name: 'Sole Inc', customer_name: 'Choi', customer_email: 'choi@example.com', created_at: '2026-10-03T05:00:00Z' });
      await insertEstimate(db, { receipt_id: 'BP20261004001', category: 'other', status: 'new_receipt', company_name: null, customer_name: null, customer_email: 'anon@example.com', created_at: '2026-10-04T03:00:00Z' });
    });

    it('lists newest first with pagination numbers', async () => {
      const res = await get('/admin/estimates');

      expect(res.status).toBe(200);
      expect(receiptsOf(res)).toEqual(['BP20261004001', 'BP20261003002', 'BP20261003001', 'BP20261002001', 'BP20261001001']);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 5, total_pages: 1 });
      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        'category', 'company_name', 'created_at', 'customer_name', 'customer_type', 'file_count', 'id', 'receipt_id', 'request_kind', 'status', 'updated_at'
      ]);
    });

    it('pages without gaps or repeats', async () => {
      const first = await get('/admin/estimates?limit=2&page=1');
      const second = await get('/admin/estimates?limit=2&page=2');
      const third = await get('/admin/estimates?limit=2&page=3');

      expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 5, total_pages: 3 });
      expect([...receiptsOf(first), ...receiptsOf(second), ...receiptsOf(third)]).toEqual([
        'BP20261004001', 'BP20261003002', 'BP20261003001', 'BP20261002001', 'BP20261001001'
      ]);
      expect(receiptsOf(third)).toHaveLength(1);
    });

    it('sorts by the requested field and direction', async () => {
      const asc = await get('/admin/estimates?sort=receipt_id&order=asc');
      const byStatus = await get('/admin/estimates?sort=status&order=asc');

      expect(receiptsOf(asc)).toEqual([...receiptsOf(asc)].sort());
      expect(byStatus.body.data.map((i: { status: string }) => i.status)).toEqual(
        ['completed', 'new_receipt', 'new_receipt', 'quoted', 'under_review']
      );
    });

    it('filters by one or several statuses and by category', async () => {
      expect(receiptsOf(await get('/admin/estimates?status=new_receipt'))).toEqual(['BP20261004001', 'BP20261001001']);
      expect(receiptsOf(await get('/admin/estimates?status=quoted,completed'))).toEqual(['BP20261003001', 'BP20261002001']);
      expect(receiptsOf(await get('/admin/estimates?category=shoes'))).toEqual(['BP20261003002', 'BP20261001001']);
      expect(receiptsOf(await get('/admin/estimates?category=shoes&status=under_review'))).toEqual(['BP20261003002']);
    });

    it('filters by created date using Korean calendar days', async () => {
      const db = suite().db;
      // 23:59:59 on 20 Oct and 00:00:00 on 21 Oct, Korean time.
      await insertEstimate(db, { receipt_id: 'BP20261020001', created_at: '2026-10-20T14:59:59Z' });
      await insertEstimate(db, { receipt_id: 'BP20261021001', created_at: '2026-10-20T15:00:00Z' });

      expect(receiptsOf(await get('/admin/estimates?created_from=2026-10-21'))).toEqual(['BP20261021001']);
      expect(receiptsOf(await get('/admin/estimates?created_to=2026-10-20&created_from=2026-10-20'))).toEqual(['BP20261020001']);
      expect(receiptsOf(await get('/admin/estimates?created_from=2026-10-03&created_to=2026-10-03'))).toEqual(['BP20261003002', 'BP20261003001']);
    });

    describe('search (q)', () => {
      it('finds by receipt id prefix, company, customer name and e-mail', async () => {
        expect(receiptsOf(await get('/admin/estimates?q=BP202610030'))).toEqual(['BP20261003002', 'BP20261003001']);
        expect(receiptsOf(await get('/admin/estimates?q=fairway'))).toEqual(['BP20261003001']);
        expect(receiptsOf(await get('/admin/estimates?q=minsu'))).toEqual(['BP20261001001']);
        expect(receiptsOf(await get('/admin/estimates?q=park@golf'))).toEqual(['BP20261003001']);
      });

      it('finds by phone number, ignoring dashes and spaces', async () => {
        expect(receiptsOf(await get('/admin/estimates?q=9876-5432'))).toEqual(['BP20261002001']);
        expect(receiptsOf(await get('/admin/estimates?q=01098765432'))).toEqual(['BP20261002001']);
      });

      it('treats % and _ as plain characters', async () => {
        expect(receiptsOf(await get('/admin/estimates?q=100%25'))).toEqual(['BP20261001001']);
        expect(receiptsOf(await get('/admin/estimates?q=%25'))).toEqual(['BP20261001001']);
        expect(receiptsOf(await get('/admin/estimates?q=Optic_Plus'))).toEqual(['BP20261002001']);
        expect(receiptsOf(await get('/admin/estimates?q=Optic%25Plus'))).toEqual([]);
      });

      it('returns nothing for a search without a match, and total 0', async () => {
        const res = await get('/admin/estimates?q=zzzzzz');

        expect(res.body.data).toEqual([]);
        expect(res.body.pagination.total).toBe(0);
      });

      it('combines a search with a filter', async () => {
        expect(receiptsOf(await get('/admin/estimates?q=example.com&status=new_receipt'))).toEqual(['BP20261004001', 'BP20261001001']);
      });
    });

    it('counts the files of each estimate', async () => {
      const target = await suite().db('estimates').where({ receipt_id: 'BP20261001001' }).first();
      await suite().db('files').insert([
        { estimate_id: target.id, filename: 'a.png', file_size: 1, mime_type: 'image/png', s3_key: 'secret/a' },
        { estimate_id: target.id, filename: 'b.png', file_size: 2, mime_type: 'image/png', s3_key: 'secret/b' }
      ]);

      const res = await get('/admin/estimates?q=BP20261001001');

      expect(res.body.data[0].file_count).toBe(2);
    });

    it('a manager can list as well; a request without a session cannot', async () => {
      expect((await get('/admin/estimates', manager)).status).toBe(200);
      expect((await request(app).get('/admin/estimates')).status).toBe(401);
    });
  });

  describe('the ten statuses of the PRD (migration 013)', () => {
    let id: string;

    beforeEach(async () => {
      id = (await insertEstimate(suite().db)).id;
    });

    const statusOf = async (estimateId = id) => (await suite().db('estimates').where({ id: estimateId }).first()).status;
    const move = (to: string, reason?: string, session = manager, estimateId = id) =>
      patchStatus(estimateId, reason ? { to_status: to, reason } : { to_status: to }, session);
    const detailHistory = async (estimateId = id) =>
      (await get(`/admin/estimates/${estimateId}`)).body.data.status_history as Array<{
        old_status: string | null;
        new_status: string;
        retired_status: boolean;
      }>;

    it('a manager walks a request through the whole working flow, every step is recorded and none is retired', async () => {
      const flow: Array<[string, string?]> = [
        ['under_review'], ['info_requested'], ['under_review'], ['factory_checking'], ['quoted'],
        ['customer_review'], ['quoted'], ['customer_review'], ['accepted'], ['completed', 'delivered']
      ];

      for (const [to, reason] of flow) {
        const res = await move(to, reason);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(to);
      }

      expect(await statusOf()).toBe('completed');
      const rows = await history(id);
      expect(rows).toHaveLength(flow.length);
      expect(rows.map(r => r.new_status)).toEqual(flow.map(([to]) => to));
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i].old_status).toBe(rows[i - 1].new_status);
      }
      expect((await detailHistory()).every(h => h.retired_status === false)).toBe(true);
    });

    it('a quote can be accepted directly, and also after the customer review', async () => {
      const direct = id;
      const viaReview = (await insertEstimate(suite().db)).id;
      for (const target of [direct, viaReview]) {
        expect((await move('under_review', undefined, manager, target)).status).toBe(200);
        expect((await move('quoted', undefined, manager, target)).status).toBe(200);
      }

      expect((await move('accepted', undefined, manager, direct)).status).toBe(200);
      expect((await move('customer_review', undefined, manager, viaReview)).status).toBe(200);
      expect((await move('accepted', undefined, manager, viaReview)).status).toBe(200);

      expect([await statusOf(direct), await statusOf(viaReview)]).toEqual(['accepted', 'accepted']);
    });

    it('completed and cancelled are end points: every change out of them is refused with 422', async () => {
      await move('under_review');
      await move('quoted');
      await move('accepted');
      await move('completed', 'done');
      const cancelled = (await insertEstimate(suite().db)).id;
      expect((await move('cancelled', 'customer asked', admin, cancelled)).status).toBe(200);

      for (const [target, from] of [[id, 'completed'], [cancelled, 'cancelled']] as const) {
        for (const to of ['new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted', 'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled']) {
          if (to === from) {
            continue;
          }
          const res = await patchStatus(target, { to_status: to, reason: 'again' }, admin);
          expect(res.status).toBe(422);
          expect(res.body.code).toBe('INVALID_TRANSITION');
        }
      }
      expect(await statusOf()).toBe('completed');
      expect(await statusOf(cancelled)).toBe('cancelled');
    });

    it('refuses what the table does not list, without touching the request', async () => {
      const skip = await move('info_requested'); // new_receipt -> info_requested is not listed
      await move('under_review');
      const back = await move('new_receipt');
      const jump = await move('accepted');
      const noFactory = await move('customer_review');

      expect([skip.status, back.status, jump.status, noFactory.status]).toEqual([422, 422, 422, 422]);
      expect(await statusOf()).toBe('under_review');
      expect(await history(id)).toHaveLength(1);
    });

    it('needs a reason for on_hold, cancelled and accepted -> completed; only an admin may cancel', async () => {
      await move('under_review');

      const noReason = await move('on_hold');
      expect([noReason.status, noReason.body.code]).toEqual([422, 'REASON_REQUIRED']);
      expect((await move('on_hold', 'waiting for samples')).status).toBe(200);
      expect((await move('under_review')).status).toBe(200);

      const managerCancel = await move('cancelled', 'customer asked', manager);
      expect([managerCancel.status, managerCancel.body.code]).toEqual([403, 'INSUFFICIENT_ROLE']);
      const adminNoReason = await move('cancelled', undefined, admin);
      expect([adminNoReason.status, adminNoReason.body.code]).toEqual([422, 'REASON_REQUIRED']);
      expect((await move('cancelled', 'customer asked', admin)).status).toBe(200);

      const other = (await insertEstimate(suite().db)).id;
      await move('under_review', undefined, manager, other);
      await move('quoted', undefined, manager, other);
      await move('accepted', undefined, manager, other);
      const completeNoReason = await move('completed', undefined, manager, other);
      expect([completeNoReason.status, completeNoReason.body.code]).toEqual([422, 'REASON_REQUIRED']);
      expect((await move('completed', 'delivered', manager, other)).status).toBe(200);
    });

    it('the retired statuses are refused as a target, as expected_status and in the list filter (400)', async () => {
      for (const retired of ['rejected', 'archived', 'negotiating']) {
        const target = await patchStatus(id, { to_status: retired, reason: 'x' });
        const expected = await patchStatus(id, { to_status: 'under_review', expected_status: retired });
        const filter = await get(`/admin/estimates?status=${retired}`);

        expect([target.status, expected.status, filter.status]).toEqual([400, 400, 400]);
      }
      expect(await statusOf()).toBe('new_receipt');
      expect(await history(id)).toHaveLength(0);
    });

    it('the list filters by the new statuses', async () => {
      const second = (await insertEstimate(suite().db)).id;
      await move('under_review');
      await move('info_requested');
      await move('under_review', undefined, manager, second);
      await move('factory_checking', undefined, manager, second);

      const infoRequested = await get('/admin/estimates?status=info_requested');
      const both = await get('/admin/estimates?status=info_requested,factory_checking');

      expect(infoRequested.body.data.map((item: { id: string }) => item.id)).toEqual([id]);
      expect(both.body.data.map((item: { id: string }) => item.id).sort()).toEqual([id, second].sort());
      expect(both.body.data.map((item: { status: string }) => item.status).sort()).toEqual(['factory_checking', 'info_requested']);
    });

    describe('old history is shown as it was written', () => {
      it('returns the stored values with retired_status, and a new entry is added next to them', async () => {
        // A request migrated from negotiating (now customer_review) with the history it had before.
        const migrated = await insertEstimate(suite().db, { status: 'customer_review' });
        const entries: Array<[string | null, string, string]> = [
          [null, 'new_receipt', '2026-10-01T01:00:00Z'],
          ['new_receipt', 'under_review', '2026-10-01T02:00:00Z'],
          ['under_review', 'quoted', '2026-10-01T03:00:00Z'],
          ['quoted', 'negotiating', '2026-10-01T04:00:00Z']
        ];
        for (const [oldStatus, newStatus, at] of entries) {
          await suite().db('status_history').insert({
            estimate_id: migrated.id, old_status: oldStatus, new_status: newStatus, changed_by: MASTER_ID, reason: 'old', created_at: at
          });
        }

        expect((await move('accepted', undefined, manager, migrated.id)).status).toBe(200);

        const rows = await detailHistory(migrated.id);
        expect(rows.map(h => [h.old_status, h.new_status, h.retired_status])).toEqual([
          ['customer_review', 'accepted', false],
          ['quoted', 'negotiating', true],
          ['under_review', 'quoted', false],
          ['new_receipt', 'under_review', false],
          [null, 'new_receipt', false]
        ]);
        // The stored rows were not changed by the new entry.
        const stored = await history(migrated.id);
        expect(stored.slice(0, 4).map(r => [r.old_status, r.new_status])).toEqual(entries.map(([o, n]) => [o, n]));
      });

      it('shows completed -> archived and a rejected entry exactly as stored, on a request that is cancelled/completed now', async () => {
        const cancelled = await insertEstimate(suite().db, { status: 'cancelled' });
        const completed = await insertEstimate(suite().db, { status: 'completed' });
        await suite().db('status_history').insert([
          { estimate_id: cancelled.id, old_status: 'under_review', new_status: 'rejected', changed_by: MASTER_ID, reason: 'cannot make it', created_at: '2026-10-02T01:00:00Z' },
          { estimate_id: completed.id, old_status: 'accepted', new_status: 'completed', changed_by: MASTER_ID, reason: 'done', created_at: '2026-10-02T01:00:00Z' },
          { estimate_id: completed.id, old_status: 'completed', new_status: 'archived', changed_by: MASTER_ID, reason: null, created_at: '2026-10-02T02:00:00Z' }
        ]);

        const afterReject = await detailHistory(cancelled.id);
        const afterArchive = await detailHistory(completed.id);

        expect(afterReject.map(h => [h.old_status, h.new_status, h.retired_status])).toEqual([['under_review', 'rejected', true]]);
        expect(afterArchive.map(h => [h.old_status, h.new_status, h.retired_status])).toEqual([
          ['completed', 'archived', true],
          ['accepted', 'completed', false]
        ]);
        // The current status of the request is a current one.
        const detail = (await get(`/admin/estimates/${completed.id}`)).body.data.estimate;
        expect(detail.status).toBe('completed');
      });

      it('retired_status is never in the customer answer', async () => {
        const migrated = await insertEstimate(suite().db, { status: 'customer_review' });
        await suite().db('estimate_access_tokens').insert({
          estimate_id: migrated.id, receipt_id: migrated.receipt_id, token: hashEstimateToken('t-for-013')
        });
        await suite().db('status_history').insert({
          estimate_id: migrated.id, old_status: 'quoted', new_status: 'negotiating', changed_by: MASTER_ID
        });

        const res = await request(app).get(`/api/estimates/${migrated.receipt_id}`).query({ token: 't-for-013' });

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/retired_status|status_history|negotiating|customer_review/);
      });
    });

    describe('at the same time', () => {
      it('five different changes from the same status, each expecting it: exactly one wins, the others get 409', async () => {
        await move('under_review');
        const attempts: Array<[string, string | undefined, typeof admin]> = [
          ['info_requested', undefined, manager],
          ['factory_checking', undefined, manager],
          ['quoted', undefined, manager],
          ['on_hold', 'waiting', manager],
          ['cancelled', 'customer asked', admin]
        ];

        const results = await Promise.all(
          attempts.map(([to, reason, session]) =>
            patchStatus(id, { to_status: to, ...(reason ? { reason } : {}), expected_status: 'under_review' }, session)
          )
        );

        expect(results.filter(r => r.status === 200)).toHaveLength(1);
        expect(results.filter(r => r.status === 409)).toHaveLength(4);
        const winner = attempts[results.findIndex(r => r.status === 200)][0];
        expect(await statusOf()).toBe(winner);
        const rows = await history(id);
        expect(rows).toHaveLength(2); // under_review, then the winner
        expect(rows[1]).toMatchObject({ old_status: 'under_review', new_status: winner });
      });

      it('accepting a quote and sending it to the customer review at once: one wins', async () => {
        await move('under_review');
        await move('quoted');

        const [accept, review] = await Promise.all([
          patchStatus(id, { to_status: 'accepted', expected_status: 'quoted' }, manager),
          patchStatus(id, { to_status: 'customer_review', expected_status: 'quoted' }, admin)
        ]);

        expect([accept.status, review.status].sort()).toEqual([200, 409]);
        expect(await history(id)).toHaveLength(3);
        expect(['accepted', 'customer_review']).toContain(await statusOf());
      });

      it('many changes without expected_status leave an unbroken chain of current statuses only', async () => {
        await move('under_review');
        const targets = ['info_requested', 'factory_checking', 'quoted', 'on_hold', 'info_requested', 'quoted', 'customer_review', 'accepted'];

        const results = await Promise.all(
          targets.map((to, i) => patchStatus(id, { to_status: to, reason: `r${i}` }, i % 2 === 0 ? admin : manager))
        );

        for (const res of results) {
          expect([200, 422]).toContain(res.status);
        }
        const rows = await history(id);
        for (let i = 1; i < rows.length; i += 1) {
          expect(rows[i].old_status).toBe(rows[i - 1].new_status);
        }
        expect(await statusOf()).toBe(rows[rows.length - 1].new_status);
        expect((await detailHistory()).every(h => h.retired_status === false)).toBe(true);
      });
    });
  });

  describe('customer type and privacy consent', () => {
    const CONSENT_AT = '2026-10-16T01:02:03.000Z';
    let withConsent: { id: string; receipt_id: string };
    let legacy: { id: string; receipt_id: string };

    beforeEach(async () => {
      // One request as the API stores it now, one as it was stored before migration 012.
      withConsent = await insertEstimate(suite().db, {
        receipt_id: 'BP20261016001',
        customer_name: 'Kim',
        company_name: 'Acme',
        customer_type: 'business_brand',
        privacy_consent_at: CONSENT_AT,
        privacy_consent_version: 'dev-draft',
        created_at: '2026-10-16T02:00:00Z'
      });
      legacy = await insertEstimate(suite().db, {
        receipt_id: 'BP20261015001',
        customer_name: 'Old',
        created_at: '2026-10-15T02:00:00Z'
      });
    });

    it('the list shows the customer type, null for the legacy request, and no consent field', async () => {
      const res = await get('/admin/estimates');

      expect(res.status).toBe(200);
      const byReceipt = Object.fromEntries(
        res.body.data.map((item: { receipt_id: string; customer_type: string | null }) => [item.receipt_id, item.customer_type])
      );
      expect(byReceipt).toEqual({ BP20261016001: 'business_brand', BP20261015001: null });
      expect(JSON.stringify(res.body)).not.toMatch(/privacy_consent|dev-draft/);
    });

    it('the detail shows the type, the consent time (ISO) and the consent version to admin and manager', async () => {
      for (const session of [admin, manager]) {
        const res = await get(`/admin/estimates/${withConsent.id}`, session);

        expect(res.status).toBe(200);
        expect(res.body.data.estimate).toMatchObject({
          customer_type: 'business_brand',
          privacy_consent_at: CONSENT_AT,
          privacy_consent_version: 'dev-draft'
        });
      }
    });

    it('the detail of a legacy request answers 200 with null for all three', async () => {
      const res = await get(`/admin/estimates/${legacy.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.estimate).toMatchObject({
        receipt_id: 'BP20261015001',
        customer_type: null,
        privacy_consent_at: null,
        privacy_consent_version: null
      });
    });

    it('both detail answers still carry no secrets: no S3 key, scan result, token or hash', async () => {
      await suite().db('files').insert({
        estimate_id: withConsent.id, filename: 'a.png', file_size: 1, mime_type: 'image/png',
        s3_key: 'estimates/secret-key/a.png', virus_scan_result: 'internal scanner output'
      });
      await suite().db('estimate_access_tokens').insert({
        estimate_id: withConsent.id, receipt_id: withConsent.receipt_id, token: 'token-hash-xyz'
      });

      const text = JSON.stringify((await get(`/admin/estimates/${withConsent.id}`)).body);

      expect(text).not.toMatch(/secret-key|internal scanner output|token-hash-xyz|s3_key|password_hash/);
    });

    it('a status change keeps the type and the consent of a request, and works on a legacy request', async () => {
      expect((await patchStatus(withConsent.id, { to_status: 'under_review' })).status).toBe(200);
      expect((await patchStatus(legacy.id, { to_status: 'under_review' })).status).toBe(200);

      const kept = await suite().db('estimates').where({ id: withConsent.id }).first();
      expect(kept.status).toBe('under_review');
      expect(kept.customer_type).toBe('business_brand');
      expect(new Date(kept.privacy_consent_at).toISOString()).toBe(CONSENT_AT);
      expect(kept.privacy_consent_version).toBe('dev-draft');

      const old = await suite().db('estimates').where({ id: legacy.id }).first();
      expect(old.status).toBe('under_review');
      expect(old.customer_type).toBeNull();
      expect(old.privacy_consent_at).toBeNull();
      expect(old.privacy_consent_version).toBeNull();
    });

    it('search and sort are unchanged: the type and the consent are not searchable', async () => {
      expect(receiptsOf(await get('/admin/estimates?q=business_brand'))).toEqual([]);
      expect(receiptsOf(await get('/admin/estimates?q=dev-draft'))).toEqual([]);
      expect(receiptsOf(await get('/admin/estimates?q=Acme'))).toEqual(['BP20261016001']);
      expect(receiptsOf(await get('/admin/estimates?sort=receipt_id&order=asc'))).toEqual(['BP20261015001', 'BP20261016001']);
      expect((await get('/admin/estimates?sort=customer_type')).status).toBe(400);
    });

    it('is not shown without a session', async () => {
      const list = await request(app).get('/admin/estimates');
      const detail = await request(app).get(`/admin/estimates/${withConsent.id}`);

      expect([list.status, detail.status]).toEqual([401, 401]);
      expect(JSON.stringify([list.body, detail.body])).not.toMatch(/privacy_consent|customer_type|business_brand/);
    });

    it('the customer lookup with the access token still shows no personal data and no consent', async () => {
      await suite().db('estimate_access_tokens').insert({
        estimate_id: withConsent.id, receipt_id: withConsent.receipt_id, token: hashEstimateToken('customer-token')
      });

      const res = await request(app)
        .get(`/api/estimates/${withConsent.receipt_id}`)
        .query({ token: 'customer-token' });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'category', 'created_at', 'message', 'receipt_id', 'specification_json', 'updated_at'
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/Kim|Acme|business_brand|privacy_consent|dev-draft/);
    });
  });

  describe('detail', () => {
    it('returns the estimate with files, history and memos, newest first, and no secrets', async () => {
      const estimate = await insertEstimate(suite().db, { customer_email: null, customer_phone: '010-1234-5678', company_name: 'Detail Co' });
      await suite().db('files').insert({
        estimate_id: estimate.id, filename: 'logo.png', file_size: 1234, mime_type: 'image/png',
        s3_key: 'estimates/secret-key/logo.png', virus_scan_result: 'internal scanner output'
      });
      await suite().db('estimate_access_tokens').insert({ estimate_id: estimate.id, receipt_id: estimate.receipt_id, token: 'token-hash-xyz' });
      await patchStatus(estimate.id, { to_status: 'under_review' });
      await postMemo(estimate.id, 'first note');
      await postMemo(estimate.id, 'second note', manager);

      const res = await get(`/admin/estimates/${estimate.id}`);

      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(data.estimate).toMatchObject({
        id: estimate.id, receipt_id: estimate.receipt_id, status: 'under_review',
        customer_email: null, customer_phone: '010-1234-5678', company_name: 'Detail Co'
      });
      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toMatchObject({ filename: 'logo.png', file_size: 1234 });
      expect(data.status_history).toHaveLength(1);
      expect(data.status_history[0]).toMatchObject({
        old_status: 'new_receipt', new_status: 'under_review', changed_by: { id: MASTER_ID, username: MASTER_USERNAME }
      });
      expect(data.memos.map((m: { content: string }) => m.content)).toEqual(['second note', 'first note']);
      expect(data.memos[0].author).toEqual({ id: managerId, username: 'staff' });

      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/secret-key|internal scanner output|token-hash-xyz|s3_key/);
    });

    it('404 for an unknown estimate, 400 for something that is not a UUID', async () => {
      expect((await get('/admin/estimates/00000000-0000-0000-0000-00000000dead')).status).toBe(404);
      expect((await get('/admin/estimates/not-a-uuid')).status).toBe(400);
    });
  });

  describe('status changes', () => {
    let id: string;

    beforeEach(async () => {
      id = (await insertEstimate(suite().db)).id;
    });

    const statusOf = async (estimateId = id) => (await suite().db('estimates').where({ id: estimateId }).first()).status;

    it('changes the status and writes one history row in the same transaction', async () => {
      const before = await suite().db('estimates').where({ id }).first();

      const res = await patchStatus(id, { to_status: 'under_review' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id, previous_status: 'new_receipt', status: 'under_review' });
      expect(await statusOf()).toBe('under_review');
      const rows = await history(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ old_status: 'new_receipt', new_status: 'under_review', changed_by: MASTER_ID, reason: null });
      expect(rows[0].id).toBe(res.body.data.history_id);
      const after = await suite().db('estimates').where({ id }).first();
      expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    });

    it('stores the reason when one is given', async () => {
      await patchStatus(id, { to_status: 'under_review' });

      const res = await patchStatus(id, { to_status: 'on_hold', reason: 'waiting for samples' });

      expect(res.status).toBe(200);
      expect((await history(id)).map(r => r.reason)).toEqual([null, 'waiting for samples']);
    });

    it('a manager may make allowed changes but not admin-only ones', async () => {
      expect((await patchStatus(id, { to_status: 'under_review' }, manager)).status).toBe(200);

      const denied = await patchStatus(id, { to_status: 'cancelled', reason: 'no' }, manager);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('INSUFFICIENT_ROLE');
      expect(await statusOf()).toBe('under_review');
      expect(await history(id)).toHaveLength(1);

      expect((await patchStatus(id, { to_status: 'cancelled', reason: 'no' }, admin)).status).toBe(200);
    });

    it('refuses invalid changes without touching the database', async () => {
      const same = await patchStatus(id, { to_status: 'new_receipt' });
      const invalid = await patchStatus(id, { to_status: 'completed', reason: 'x' });
      const noReason = await patchStatus(id, { to_status: 'cancelled' });
      const unknown = await patchStatus(id, { to_status: 'bogus' });

      expect([same.status, invalid.status, noReason.status, unknown.status]).toEqual([422, 422, 422, 400]);
      expect([same.body.code, invalid.body.code, noReason.body.code]).toEqual(['SAME_STATUS', 'INVALID_TRANSITION', 'REASON_REQUIRED']);
      expect(await statusOf()).toBe('new_receipt');
      expect(await history(id)).toHaveLength(0);
    });

    it('refuses a change when expected_status is outdated (409) and reports the current status', async () => {
      await patchStatus(id, { to_status: 'under_review' });

      const res = await patchStatus(id, { to_status: 'quoted', expected_status: 'new_receipt' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'STATUS_CONFLICT', current_status: 'under_review' });
      expect(await statusOf()).toBe('under_review');
    });

    it('404 for an unknown estimate', async () => {
      const res = await patchStatus('00000000-0000-0000-0000-00000000dead', { to_status: 'under_review' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ESTIMATE_NOT_FOUND');
    });

    it('rejects a non-JSON body with 415', async () => {
      const res = await request(app).patch(`/admin/estimates/${id}/status`).set('Cookie', admin.cookie).set('Content-Type', 'text/plain').send('to_status=under_review');

      expect(res.status).toBe(415);
    });

    describe('at the same time (FOR UPDATE)', () => {
      it('two identical changes: one succeeds, the other sees the new status', async () => {
        const [a, b] = await Promise.all([
          patchStatus(id, { to_status: 'under_review' }, admin),
          patchStatus(id, { to_status: 'under_review' }, manager)
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 422]);
        expect([a, b].find(r => r.status === 422)!.body.code).toBe('SAME_STATUS');
        expect(await history(id)).toHaveLength(1);
      });

      it('two changes that both expect the same old status: one succeeds, the other gets 409', async () => {
        const [a, b] = await Promise.all([
          patchStatus(id, { to_status: 'under_review', expected_status: 'new_receipt' }, admin),
          patchStatus(id, { to_status: 'under_review', expected_status: 'new_receipt' }, manager)
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 409]);
        expect(await history(id)).toHaveLength(1);
      });

      it('many changes at once leave a consistent, unbroken history chain', async () => {
        await patchStatus(id, { to_status: 'under_review' });

        const attempts = ['quoted', 'on_hold', 'quoted', 'on_hold', 'quoted', 'on_hold'].map((to, i) =>
          patchStatus(id, { to_status: to, reason: `r${i}` }, i % 2 === 0 ? admin : manager)
        );
        const results = await Promise.all(attempts);

        for (const res of results) {
          expect([200, 422]).toContain(res.status);
        }
        const rows = await history(id);
        expect(rows).toHaveLength(1 + results.filter(r => r.status === 200).length);
        // Every change starts where the previous one ended, and the estimate ends there too.
        for (let i = 1; i < rows.length; i += 1) {
          expect(rows[i].old_status).toBe(rows[i - 1].new_status);
        }
        expect(await statusOf()).toBe(rows[rows.length - 1].new_status);
      });
    });
  });

  describe('memos', () => {
    let id: string;

    beforeEach(async () => {
      id = (await insertEstimate(suite().db)).id;
    });

    it('creates a memo for the signed-in admin and lists it', async () => {
      const res = await postMemo(id, '  Customer wants samples  ');

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ content: 'Customer wants samples', author: { id: MASTER_ID, username: MASTER_USERNAME } });

      const row = await suite().db('admin_memos').where({ estimate_id: id }).first();
      expect(row).toMatchObject({ admin_user_id: MASTER_ID, content: 'Customer wants samples' });

      const list = await get(`/admin/estimates/${id}/memos`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.pagination).toEqual({ page: 1, limit: 20, total: 1, total_pages: 1 });
    });

    it('the author comes from the session, not from the request body', async () => {
      const res = await request(app)
        .post(`/admin/estimates/${id}/memos`)
        .set('Cookie', manager.cookie)
        .send({ content: 'spoof', admin_user_id: MASTER_ID, author: { id: MASTER_ID } });

      expect(res.status).toBe(201);
      expect((await suite().db('admin_memos').first()).admin_user_id).toBe(managerId);
    });

    it('accepts 5000 characters and refuses 5001 or an empty memo, in the API and in the table', async () => {
      expect((await postMemo(id, 'x'.repeat(5000))).status).toBe(201);
      expect((await postMemo(id, 'x'.repeat(5001))).status).toBe(400);
      expect((await postMemo(id, '   ')).status).toBe(400);
      expect((await postMemo(id, 123)).status).toBe(400);
      expect(Number((await suite().db('admin_memos').count({ n: '*' }).first())?.n)).toBe(1);
    });

    it('lists newest first and pages', async () => {
      for (const text of ['one', 'two', 'three']) {
        await postMemo(id, text);
      }

      const page1 = await get(`/admin/estimates/${id}/memos?limit=2&page=1`);
      const page2 = await get(`/admin/estimates/${id}/memos?limit=2&page=2`);

      expect(page1.body.data.map((m: { content: string }) => m.content)).toEqual(['three', 'two']);
      expect(page2.body.data.map((m: { content: string }) => m.content)).toEqual(['one']);
      expect(page1.body.pagination).toMatchObject({ total: 3, total_pages: 2 });
    });

    it('404 for an unknown estimate: nothing is written', async () => {
      const unknown = '00000000-0000-0000-0000-00000000dead';

      expect((await postMemo(unknown, 'note')).status).toBe(404);
      expect((await get(`/admin/estimates/${unknown}/memos`)).status).toBe(404);
      expect(Number((await suite().db('admin_memos').count({ n: '*' }).first())?.n)).toBe(0);
    });

    it('memos of one estimate never show up on another', async () => {
      const other = (await insertEstimate(suite().db)).id;
      await postMemo(id, 'for the first');

      expect((await get(`/admin/estimates/${other}/memos`)).body.data).toEqual([]);
    });
  });

  describe('file metadata', () => {
    it('lists metadata without storage keys or scanner output', async () => {
      const estimate = await insertEstimate(suite().db);
      await suite().db('files').insert({
        estimate_id: estimate.id, filename: 'design.pdf', file_size: 99, mime_type: 'application/pdf',
        s3_key: 'estimates/hidden/design.pdf', virus_scan_result: 'hidden result'
      });

      const res = await get(`/admin/estimates/${estimate.id}/files`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ filename: 'design.pdf', file_size: 99, file_status: 'quarantine' });
      expect(JSON.stringify(res.body)).not.toMatch(/hidden|s3_key/);
    });

    it('downloads stay blocked for an unscanned file', async () => {
      const estimate = await insertEstimate(suite().db);
      const [file] = await suite().db('files').insert({
        estimate_id: estimate.id, filename: 'a.png', file_size: 1, mime_type: 'image/png', s3_key: 'k'
      }).returning('id');

      const res = await get(`/admin/estimates/${estimate.id}/files/${file.id}/download`);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
