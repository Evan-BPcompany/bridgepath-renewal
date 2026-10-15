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
        'category', 'company_name', 'created_at', 'customer_name', 'customer_type', 'file_count', 'id', 'receipt_id', 'status', 'updated_at'
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
        'category', 'created_at', 'receipt_id', 'specification_json', 'status', 'updated_at'
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

      const denied = await patchStatus(id, { to_status: 'rejected', reason: 'no' }, manager);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('INSUFFICIENT_ROLE');
      expect(await statusOf()).toBe('under_review');
      expect(await history(id)).toHaveLength(1);

      expect((await patchStatus(id, { to_status: 'rejected', reason: 'no' }, admin)).status).toBe(200);
    });

    it('refuses invalid changes without touching the database', async () => {
      const same = await patchStatus(id, { to_status: 'new_receipt' });
      const invalid = await patchStatus(id, { to_status: 'completed', reason: 'x' });
      const noReason = await patchStatus(id, { to_status: 'rejected' });
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
