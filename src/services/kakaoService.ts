import { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { config } from '../config/env';
import logger from '../utils/logger';
import { quoteLink } from '../utils/quoteEmail';
import {
  KakaoTemplateCode,
  KakaoVariables,
  RenderedKakaoMessage,
  maskPhone,
  normalizeKoreanMobile,
  renderKakaoMessage
} from '../utils/kakaoMessage';

// KakaoTalk notices through an outbox, like the e-mails: a row is written in the same transaction as
// the thing it tells about, and a worker sends it later and retries. Nothing is sent from here to
// Kakao directly; the sending agency sits behind KakaoSender.

export interface KakaoSender {
  // Returns the id the agency gives to the message. Throws when it could not be sent (it is retried).
  send(message: RenderedKakaoMessage & { phone: string; templateCode: KakaoTemplateCode }): Promise<string>;
}

// Development: writes the message to the log, without the whole number, and sends nothing.
export const logSender: KakaoSender = {
  async send(message) {
    logger.info('KakaoTalk notice (log provider, nothing is sent)', {
      template: message.templateCode,
      phone: maskPhone(message.phone),
      text: message.text,
      link: message.link
    });
    return `log-${Date.now()}`;
  }
};

let sender: KakaoSender = logSender;

export function setKakaoSender(next: KakaoSender): void {
  sender = next;
}

export interface QueueKakaoInput {
  customerId: string | null | undefined;
  estimateId: string;
  template: KakaoTemplateCode;
  receiptId: string;
  // Makes the notice happen once, however often the caller runs: for example `receipt-<estimate id>`.
  key: string;
}

// Writes the notice in the caller's transaction. Returns false (and writes nothing) when notices are
// switched off, when there is no account, or when the customer has not agreed, has no Korean mobile
// number, or has been switched off.
export async function queueKakaoInTransaction(client: PoolClient, input: QueueKakaoInput): Promise<boolean> {
  if (!config.kakao.enabled || !input.customerId) {
    return false;
  }
  const found = await client.query(
    `SELECT phone, kakao_notify_consent_at FROM customers WHERE id = $1 AND is_active = true`,
    [input.customerId]
  );
  const customer = found.rows[0];
  const phone = customer ? normalizeKoreanMobile(customer.phone) : undefined;
  if (!customer || !customer.kakao_notify_consent_at || !phone) {
    return false;
  }

  const variables: KakaoVariables = {
    receipt_id: input.receiptId,
    link: quoteLink(config.frontendBaseUrl, input.receiptId)
  };
  const inserted = await client.query(
    `INSERT INTO kakao_events (customer_id, estimate_id, recipient_phone, template_code, variables, idempotency_key)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [input.customerId, input.estimateId, phone, input.template, JSON.stringify(variables), input.key]
  );
  return (inserted.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------
// The worker

interface KakaoEvent {
  id: string;
  recipient_phone: string;
  template_code: KakaoTemplateCode;
  variables: KakaoVariables;
  retry_count: number;
}

const RETRY_MINUTES = [1, 2, 4];

async function claim(limit: number): Promise<KakaoEvent[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, recipient_phone, template_code, variables, retry_count
       FROM kakao_events
       WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const events = result.rows as KakaoEvent[];
    if (events.length > 0) {
      await client.query(`UPDATE kakao_events SET status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`, [
        events.map(event => event.id)
      ]);
    }
    await client.query('COMMIT');
    return events;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may be gone; the original error is rethrown.
    }
    throw err;
  } finally {
    client.release();
  }
}

async function markSent(id: string, providerMessageId: string): Promise<void> {
  await getPool().query(
    `UPDATE kakao_events SET status = 'sent', sent_at = CURRENT_TIMESTAMP, provider_message_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, providerMessageId]
  );
}

// Three retries, after 1, 2 and 4 minutes; then it stays failed.
async function markFailed(event: KakaoEvent, error: string): Promise<void> {
  const delay = RETRY_MINUTES[event.retry_count];
  if (delay === undefined) {
    await getPool().query(`UPDATE kakao_events SET status = 'failed', last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      event.id,
      error.slice(0, 500)
    ]);
    return;
  }
  await getPool().query(
    `UPDATE kakao_events
     SET status = 'pending', retry_count = retry_count + 1, last_error = $2,
         next_retry_at = CURRENT_TIMESTAMP + make_interval(mins => $3), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [event.id, error.slice(0, 500), delay]
  );
}

// A worker that died while sending leaves its events in 'sending': they go back to the queue.
async function recoverStale(): Promise<void> {
  await getPool().query(
    `UPDATE kakao_events
     SET status = 'pending', next_retry_at = CURRENT_TIMESTAMP + interval '1 minute', last_error = 'Recovered from stale sending state', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'sending' AND updated_at < CURRENT_TIMESTAMP - interval '5 minutes'`
  );
}

export async function processPendingKakaoEvents(): Promise<number> {
  await recoverStale();
  const events = await claim(10);
  for (const event of events) {
    try {
      const message = renderKakaoMessage(event.template_code, event.variables);
      const id = await sender.send({ ...message, phone: event.recipient_phone, templateCode: event.template_code });
      await markSent(event.id, id);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      logger.warn('KakaoTalk notice failed', { event_id: event.id, error: text });
      await markFailed(event, text);
    }
  }
  return events.length;
}

let loop: NodeJS.Timeout | null = null;

export function startKakaoWorker(): void {
  if (!config.kakao.enabled || loop !== null) {
    return;
  }
  logger.info('Starting KakaoTalk notice worker', { provider: config.kakao.provider, interval_ms: config.kakao.intervalMs });
  loop = setInterval(() => {
    processPendingKakaoEvents().catch(err => {
      logger.error('KakaoTalk worker error', { error: err instanceof Error ? err.message : String(err) });
    });
  }, config.kakao.intervalMs);
}

export function stopKakaoWorker(): void {
  if (loop !== null) {
    clearInterval(loop);
    loop = null;
  }
}
