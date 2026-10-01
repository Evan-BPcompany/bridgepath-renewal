import { getPool } from '../config/database';
import { config } from '../config/env';
import { generateReceiptIdInTransaction } from '../utils/receipt-id';
import { generateEstimateAccessToken } from '../utils/token';
import { queueEmailInTransaction } from './emailService';
import logger from '../utils/logger';

export interface CreateEstimateRequest {
  category: string;
  specification_json: unknown;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  company_name?: string;
}

export interface CreateEstimateResponse {
  success: boolean;
  receipt_id: string;
  estimate_id: string;
  status: string;
  access_token: string;
  created_at: string;
}

export interface EstimateDetails {
  receipt_id: string;
  category: string;
  status: string;
  specification_json: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Build HTML email body for customer receipt confirmation
 */
function buildCustomerReceiptEmail(data: {
  receipt_id: string;
  status: string;
  created_at: string;
}): string {
  const createdAt = new Date(data.created_at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul'
  });

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Bridge Path 접수 완료</h2>
        <p>귀사의 견적 요청이 정상적으로 접수되었습니다.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수번호</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${data.receipt_id}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">상태</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${data.status}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수일시</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${createdAt}</td>
          </tr>
        </table>
        <p>저희 팀에서 빠른 시일 내에 연락드리겠습니다.</p>
        <p>문의사항이 있으시면 contact@bridgepath.co.kr로 연락주세요.</p>
      </body>
    </html>
  `;
}

/**
 * Build HTML email body for admin notification
 */
function buildAdminNotificationEmail(data: {
  receipt_id: string;
  category: string;
  created_at: string;
}): string {
  const createdAt = new Date(data.created_at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul'
  });

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>새로운 견적 요청</h2>
        <p>고객으로부터 새로운 견적 요청이 접수되었습니다.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수번호</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${data.receipt_id}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">제품분류</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${data.category}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수일시</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${createdAt}</td>
          </tr>
        </table>
        <p>상세 내용은 관리자 대시보드에서 확인하세요.</p>
      </body>
    </html>
  `;
}

export async function createEstimate(
  request: CreateEstimateRequest
): Promise<CreateEstimateResponse> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    const receipt_id = await generateReceiptIdInTransaction(client);
    const { token, hash } = generateEstimateAccessToken();

    const estimateQuery = `
      INSERT INTO estimates (
        receipt_id, category, customer_name, customer_email,
        customer_phone, company_name, specification_json, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'new_receipt')
      RETURNING id, receipt_id, status, created_at
    `;

    const estimateResult = await client.query(estimateQuery, [
      receipt_id,
      request.category,
      request.customer_name || null,
      request.customer_email || null,
      request.customer_phone || null,
      request.company_name || null,
      JSON.stringify(request.specification_json)
    ]);

    if (estimateResult.rows.length === 0) {
      throw new Error('Failed to create estimate');
    }

    const estimate = estimateResult.rows[0];

    const tokenQuery = `
      INSERT INTO estimate_access_tokens (
        estimate_id, receipt_id, token
      )
      VALUES ($1, $2, $3)
      RETURNING id
    `;

    await client.query(tokenQuery, [estimate.id, receipt_id, hash]);

    // Queue email events (outbox pattern - same transaction)
    // Customer receipt email
    if (request.customer_email) {
      const receiptEmailBody = buildCustomerReceiptEmail({
        receipt_id,
        status: 'new_receipt',
        created_at: estimate.created_at
      });

      await queueEmailInTransaction(client, {
        recipient_email: request.customer_email,
        email_type: 'receipt',
        estimate_id: estimate.id,
        idempotency_key: `receipt-${estimate.id}`,
        subject: `Bridge Path 접수 완료: ${receipt_id}`,
        body: receiptEmailBody
      });
    }

    // Admin notification email
    if (config.adminNotificationEmail) {
      const adminEmailBody = buildAdminNotificationEmail({
        receipt_id,
        category: request.category,
        created_at: estimate.created_at
      });

      await queueEmailInTransaction(client, {
        recipient_email: config.adminNotificationEmail,
        email_type: 'admin_notification',
        estimate_id: estimate.id,
        idempotency_key: `admin-${estimate.id}`,
        subject: `[Bridge Path] 새 접수: ${receipt_id}`,
        body: adminEmailBody
      });
    }

    await client.query('COMMIT');

    logger.info('Estimate created', {
      receipt_id,
      category: request.category,
      email: request.customer_email ? '[REDACTED]' : 'not-provided'
    });

    return {
      success: true,
      receipt_id,
      estimate_id: estimate.id,
      status: 'new_receipt',
      access_token: token,
      created_at: new Date(estimate.created_at).toISOString()
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to create estimate', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function getEstimateByReceiptId(
  receipt_id: string,
  tokenHash: string
): Promise<EstimateDetails | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE estimate_access_tokens
      SET is_used = true, visited_at = CURRENT_TIMESTAMP, visit_count = visit_count + 1
      WHERE token = $1 AND receipt_id = $2 AND is_used = false AND expires_at > CURRENT_TIMESTAMP
      RETURNING estimate_id
    `;

    const updateResult = await client.query(updateQuery, [tokenHash, receipt_id]);

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const estimateId = updateResult.rows[0].estimate_id;

    const query = `
      SELECT
        e.receipt_id, e.category, e.status, e.specification_json,
        e.created_at, e.updated_at
      FROM estimates e
      WHERE e.id = $1
      LIMIT 1
    `;

    const result = await client.query(query, [estimateId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');

    const row = result.rows[0];

    return {
      receipt_id: row.receipt_id,
      category: row.category,
      status: row.status,
      specification_json: row.specification_json,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString()
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback error
    }
    logger.error('Failed to get estimate', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}
