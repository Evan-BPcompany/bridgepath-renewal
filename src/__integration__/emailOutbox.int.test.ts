jest.mock('../config/database', () => ({ getPool: jest.fn() }));
// SendGrid is replaced by a stub: no request can leave the machine (the network guard of
// jest.setup.js would refuse it as well).
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

import logger from '../utils/logger';
import { config } from '../config/env';
import {
  claimPendingEmailEvents,
  markEmailSent,
  queueEmailInTransaction,
  recoverStaleEmailEvents,
  scheduleEmailRetry
} from '../services/emailService';
import { processPendingEmailEvents } from '../services/emailWorker';
import { getPool } from '../config/database';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { insertEstimate, resetData } from './helpers/fixtures';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sendgrid = require('@sendgrid/mail') as { setApiKey: jest.Mock; send: jest.Mock };

// The e-mail outbox on a real PostgreSQL: queueing, claiming with FOR UPDATE SKIP LOCKED,
// the retry schedule (1, 2, 4 minutes, then failed) and recovery of stuck events.
describeIntegration('e-mail outbox on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let estimateId: string;
  let saved: { apiKey?: string; from?: string };

  const queue = async (key: string, to = 'buyer@example.com') => {
    const client = await getPool().connect();
    try {
      await queueEmailInTransaction(client, {
        recipient_email: to,
        email_type: 'receipt',
        estimate_id: estimateId,
        idempotency_key: key,
        subject: `subject ${key}`,
        body: '<p>body</p>'
      });
    } finally {
      client.release();
    }
  };

  const event = (key: string) => suite().db('email_events').where({ idempotency_key: key }).first();
  const statuses = async () =>
    Object.fromEntries(
      (await suite().db('email_events').select('idempotency_key', 'status').orderBy('idempotency_key')).map(
        (row: { idempotency_key: string; status: string }) => [row.idempotency_key, row.status]
      )
    );
  const makeDue = (key: string) =>
    suite().db('email_events').where({ idempotency_key: key }).update({
      next_retry_at: suite().db.raw("CURRENT_TIMESTAMP - INTERVAL '1 second'")
    });
  const minutesUntilRetry = async (key: string) =>
    (new Date((await event(key)).next_retry_at).getTime() - Date.now()) / 60_000;

  beforeEach(async () => {
    await resetData(suite().db);
    estimateId = (await insertEstimate(suite().db)).id;
    saved = { apiKey: config.sendgridApiKey, from: config.sendgridFromEmail };
    sendgrid.setApiKey.mockReset();
    sendgrid.send.mockReset();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    config.sendgridApiKey = saved.apiKey;
    config.sendgridFromEmail = saved.from;
    jest.restoreAllMocks();
  });

  describe('queueing', () => {
    it('stores a pending event with zero retries', async () => {
      await queue('k1');

      expect(await event('k1')).toMatchObject({
        recipient_email: 'buyer@example.com',
        email_type: 'receipt',
        estimate_id: estimateId,
        status: 'pending',
        retry_count: 0,
        next_retry_at: null,
        provider_message_id: null,
        sent_at: null
      });
    });

    it('queueing the same idempotency key twice keeps one event', async () => {
      await queue('same');
      await queue('same', 'someone-else@example.com');

      const rows = await suite().db('email_events').where({ idempotency_key: 'same' });
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_email).toBe('buyer@example.com');
    });
  });

  describe('claiming', () => {
    it('claims pending events oldest first, up to the limit, and marks them sending', async () => {
      for (const key of ['a', 'b', 'c']) {
        await queue(key);
        await suite().db.raw('SELECT pg_sleep(0.01)');
      }

      const claimed = await claimPendingEmailEvents(2);

      expect(claimed.map(e => e.idempotency_key)).toEqual(['a', 'b']);
      expect(await statuses()).toEqual({ a: 'sending', b: 'sending', c: 'pending' });
    });

    it('does not claim an event that is already sending (no second delivery)', async () => {
      await queue('busy');
      expect(await claimPendingEmailEvents(10)).toHaveLength(1);

      expect(await claimPendingEmailEvents(10)).toEqual([]);
      expect(await statuses()).toEqual({ busy: 'sending' });
    });

    it('does not claim sent or failed events', async () => {
      await queue('done');
      await queue('dead');
      await suite().db('email_events').where({ idempotency_key: 'done' }).update({ status: 'sent' });
      await suite().db('email_events').where({ idempotency_key: 'dead' }).update({ status: 'failed' });

      expect(await claimPendingEmailEvents(10)).toEqual([]);
    });

    it('waits for next_retry_at before claiming a retry', async () => {
      await queue('later');
      await suite().db('email_events').where({ idempotency_key: 'later' }).update({
        next_retry_at: suite().db.raw("CURRENT_TIMESTAMP + INTERVAL '5 minutes'")
      });
      expect(await claimPendingEmailEvents(10)).toEqual([]);

      await makeDue('later');
      expect((await claimPendingEmailEvents(10)).map(e => e.idempotency_key)).toEqual(['later']);
    });

    it('two workers claiming at the same time never get the same event', async () => {
      for (let i = 0; i < 12; i += 1) {
        await queue(`e${String(i).padStart(2, '0')}`);
      }

      const [first, second] = await Promise.all([claimPendingEmailEvents(12), claimPendingEmailEvents(12)]);

      const ids = [...first, ...second].map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Between them they got every event (SKIP LOCKED skips rows, it does not lose them).
      const left = await claimPendingEmailEvents(12);
      expect(ids.length + left.length).toBe(12);
      expect(Object.values(await statuses()).every(s => s === 'sending')).toBe(true);
    });

    it('5 workers at once: each event is claimed exactly once', async () => {
      for (let i = 0; i < 20; i += 1) {
        await queue(`p${String(i).padStart(2, '0')}`);
      }

      const batches = await Promise.all(Array.from({ length: 5 }, () => claimPendingEmailEvents(10)));

      const ids = batches.flat().map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(20);
      const stillPending = await suite().db('email_events').where({ status: 'pending' }).count({ n: '*' }).first();
      expect(ids.length + Number(stillPending?.n)).toBe(20);
    });
  });

  describe('result of a send', () => {
    it('markEmailSent stores the provider id and the time', async () => {
      await queue('ok');
      const [claimed] = await claimPendingEmailEvents(1);

      await markEmailSent(claimed.id, 'sg-message-1');

      expect(await event('ok')).toMatchObject({ status: 'sent', provider_message_id: 'sg-message-1' });
      expect((await event('ok')).sent_at).not.toBeNull();
    });
  });

  describe('retry schedule: 1, 2, 4 minutes, then failed', () => {
    it('walks through the whole schedule', async () => {
      await queue('retry');
      const [claimed] = await claimPendingEmailEvents(1);

      const expectedMinutes = [1, 2, 4];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await scheduleEmailRetry(claimed.id, `error ${attempt}`);

        const row = await event('retry');
        expect(row.status).toBe('pending');
        expect(row.retry_count).toBe(attempt);
        expect(row.last_error).toBe(`error ${attempt}`);
        const minutes = await minutesUntilRetry('retry');
        expect(minutes).toBeGreaterThan(expectedMinutes[attempt - 1] - 0.5);
        expect(minutes).toBeLessThanOrEqual(expectedMinutes[attempt - 1]);
      }

      await scheduleEmailRetry(claimed.id, 'final error');
      expect(await event('retry')).toMatchObject({ status: 'failed', retry_count: 3, last_error: 'final error' });

      await makeDue('retry');
      expect(await claimPendingEmailEvents(10)).toEqual([]);
    });

    it('an unknown event id changes nothing', async () => {
      await queue('x');

      await scheduleEmailRetry('00000000-0000-0000-0000-00000000dead', 'boom');

      expect(await statuses()).toEqual({ x: 'pending' });
    });
  });

  describe('recovering stuck events', () => {
    const makeStale = (key: string) =>
      suite().db('email_events').where({ idempotency_key: key }).update({
        updated_at: suite().db.raw("CURRENT_TIMESTAMP - INTERVAL '1 hour'")
      });

    it('moves an old sending event back to pending, to be claimed again after a minute', async () => {
      await queue('stuck');
      await claimPendingEmailEvents(1);
      await makeStale('stuck');

      await recoverStaleEmailEvents();

      const row = await event('stuck');
      expect(row.status).toBe('pending');
      expect(row.last_error).toBe('Recovered from stale sending state');
      expect(await minutesUntilRetry('stuck')).toBeGreaterThan(0.5);

      await makeDue('stuck');
      expect((await claimPendingEmailEvents(1)).map(e => e.idempotency_key)).toEqual(['stuck']);
    });

    it('marks it failed when it already used all its retries', async () => {
      await queue('worn');
      await claimPendingEmailEvents(1);
      await suite().db('email_events').where({ idempotency_key: 'worn' }).update({ retry_count: 3 });
      await makeStale('worn');

      await recoverStaleEmailEvents();

      expect(await event('worn')).toMatchObject({ status: 'failed', next_retry_at: null });
    });

    it('leaves a recent sending event and other states alone', async () => {
      await queue('fresh');
      await claimPendingEmailEvents(1);
      await queue('waiting');
      await queue('finished');
      await suite().db('email_events').where({ idempotency_key: 'finished' }).update({ status: 'sent' });
      await makeStale('finished');
      await makeStale('waiting');

      await recoverStaleEmailEvents();

      expect(await statuses()).toEqual({ fresh: 'sending', finished: 'sent', waiting: 'pending' });
    });
  });

  describe('the worker (SendGrid stubbed)', () => {
    beforeEach(() => {
      config.sendgridApiKey = 'stub-key';
      config.sendgridFromEmail = 'noreply@bridgepath.test';
    });

    it('sends pending events and records the message id', async () => {
      sendgrid.send.mockResolvedValue([{ headers: { 'x-message-id': 'stub-id-1' } }]);
      await queue('w1');
      await queue('w2');

      await processPendingEmailEvents();

      expect(sendgrid.send).toHaveBeenCalledTimes(2);
      expect(await statuses()).toEqual({ w1: 'sent', w2: 'sent' });
      expect((await event('w1')).provider_message_id).toBe('stub-id-1');
    });

    it('a second run does not send the same events again', async () => {
      sendgrid.send.mockResolvedValue([{ headers: { 'x-message-id': 'stub-id' } }]);
      await queue('once');

      await processPendingEmailEvents();
      await processPendingEmailEvents();

      expect(sendgrid.send).toHaveBeenCalledTimes(1);
    });

    it('a failing send schedules a retry and does not stop the other events', async () => {
      sendgrid.send
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce([{ headers: { 'x-message-id': 'stub-id-2' } }]);
      await queue('f1');
      await queue('f2');

      await processPendingEmailEvents();

      const states = await statuses();
      expect(Object.values(states).sort()).toEqual(['pending', 'sent']);
      const failed = await suite().db('email_events').where({ status: 'pending' }).first();
      expect(failed.retry_count).toBe(1);
      expect(failed.last_error).toContain('provider down');
    });

    it('without an API key the events stay pending with a retry scheduled and nothing is sent', async () => {
      config.sendgridApiKey = undefined;
      await queue('nokey');

      await processPendingEmailEvents();

      expect(sendgrid.send).not.toHaveBeenCalled();
      expect(await event('nokey')).toMatchObject({ status: 'pending', retry_count: 1 });
    });

    it('two workers running at the same time send each event once', async () => {
      sendgrid.send.mockResolvedValue([{ headers: { 'x-message-id': 'stub-id' } }]);
      for (let i = 0; i < 6; i += 1) {
        await queue(`dup${i}`);
      }

      await Promise.all([processPendingEmailEvents(), processPendingEmailEvents()]);

      expect(sendgrid.send).toHaveBeenCalledTimes(6);
      expect(Object.values(await statuses()).every(s => s === 'sent')).toBe(true);
    });
  });
});
