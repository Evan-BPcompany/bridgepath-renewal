jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/emailService', () => ({ queueEmailInTransaction: jest.fn() }));
jest.mock('../utils/receipt-id', () => ({
  generateReceiptIdInTransaction: jest.fn(async () => 'BP20261013001')
}));

import { getPool } from '../config/database';
import { config } from '../config/env';
import { queueEmailInTransaction } from '../services/emailService';
import { createEstimate } from '../services/estimateService';

describe('createEstimate email events with the optional customer email', () => {
  const originalAdminEmail = config.adminNotificationEmail;
  let estimateInsertParams: unknown[];

  beforeEach(() => {
    estimateInsertParams = [];
    (queueEmailInTransaction as jest.Mock).mockReset();

    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO estimates')) {
          estimateInsertParams = params ?? [];
          return { rows: [{ id: 'est-1', receipt_id: 'BP20261013001', status: 'new_receipt', created_at: new Date() }] };
        }
        if (sql.includes('INSERT INTO estimate_access_tokens')) {
          return { rows: [{ id: 'tok-1' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn()
    };
    (getPool as jest.Mock).mockReturnValue({ connect: jest.fn(async () => client) });

    config.adminNotificationEmail = 'admin@example.com';
  });

  afterAll(() => {
    config.adminNotificationEmail = originalAdminEmail;
  });

  const types = () =>
    (queueEmailInTransaction as jest.Mock).mock.calls.map(call => call[1].email_type as string);

  it('skips the customer receipt but still queues the admin notification when only a phone is given', async () => {
    await createEstimate({
      category: 'eyewear',
      specification_json: { quantity: 1 },
      customer_phone: '010-1234-5678'
    });

    expect(types()).toEqual(['admin_notification']);
    // customer_email is stored as NULL (index 3 of the INSERT parameters)
    expect(estimateInsertParams[3]).toBeNull();
    expect(estimateInsertParams[4]).toBe('010-1234-5678');
  });

  it('queues both emails when an email is given', async () => {
    await createEstimate({
      category: 'eyewear',
      specification_json: { quantity: 1 },
      customer_email: 'buyer@example.com'
    });

    expect(types()).toEqual(['receipt', 'admin_notification']);
    const receipt = (queueEmailInTransaction as jest.Mock).mock.calls[0][1];
    expect(receipt.recipient_email).toBe('buyer@example.com');
  });

  it('does not queue an admin notification when no admin address is configured', async () => {
    config.adminNotificationEmail = undefined;

    await createEstimate({
      category: 'eyewear',
      specification_json: { quantity: 1 },
      customer_email: 'buyer@example.com'
    });

    expect(types()).toEqual(['receipt']);
  });

  it('keeps the admin notification free of category and customer details', async () => {
    await createEstimate({
      category: 'eyewear',
      specification_json: { quantity: 1 },
      customer_phone: '010-1234-5678',
      customer_name: 'Kim'
    });

    const admin = (queueEmailInTransaction as jest.Mock).mock.calls[0][1];
    expect(admin.body).toContain('BP20261013001');
    expect(admin.body).not.toContain('eyewear');
    expect(admin.body).not.toContain('010-1234-5678');
    expect(admin.body).not.toContain('Kim');
  });
});
