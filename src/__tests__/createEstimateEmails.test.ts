jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/emailService', () => ({ queueEmailInTransaction: jest.fn() }));
jest.mock('../utils/receipt-id', () => ({
  generateReceiptIdInTransaction: jest.fn(async () => 'BP20261013001')
}));

import { getPool } from '../config/database';
import { config } from '../config/env';
import { queueEmailInTransaction } from '../services/emailService';
import { createEstimate } from '../services/estimateService';
import { SERVICE_PROFILE } from './helpers/customerFixtures';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';

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
      ...SERVICE_PROFILE,
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
      ...SERVICE_PROFILE,
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
      ...SERVICE_PROFILE,
      category: 'eyewear',
      specification_json: { quantity: 1 },
      customer_email: 'buyer@example.com'
    });

    expect(types()).toEqual(['receipt']);
  });

  describe('what the customer e-mail says (PRD FR-4.9.2, FR-4.9.3)', () => {
    const customerEmail = async () => {
      await createEstimate({
        ...SERVICE_PROFILE,
        category: 'eyewear',
        specification_json: { quantity: 1 },
        customer_email: 'buyer@example.com'
      });
      return (queueEmailInTransaction as jest.Mock).mock.calls[0][1];
    };

    it('contains the fixed guidance sentence of the PRD and the receipt number', async () => {
      const receipt = await customerEmail();

      expect(receipt.email_type).toBe('receipt');
      expect(receipt.body).toContain(CUSTOMER_GUIDANCE_MESSAGE);
      expect(receipt.body).toContain('BP20261013001');
    });

    it('shows no internal status: no status row and no status code of any kind', async () => {
      const receipt = await customerEmail();

      expect(receipt.body).not.toMatch(/new_receipt|under_review|info_requested|factory_checking|quoted|customer_review|negotiating|accepted|on_hold|completed|cancelled|rejected|archived/);
      expect(receipt.body).not.toContain('상태');
    });

    it('makes no promise about time ("빠른 시일 내", "곧", "신속")', async () => {
      const receipt = await customerEmail();

      expect(receipt.body).not.toMatch(/빠른 시일|곧 |신속|즉시|최대한/);
      expect(receipt.subject).not.toMatch(/new_receipt/);
    });

    it('the admin notification is unchanged: it still shows the internal status', async () => {
      await createEstimate({
        ...SERVICE_PROFILE,
        category: 'eyewear',
        specification_json: { quantity: 1 },
        customer_email: 'buyer@example.com'
      });

      const admin = (queueEmailInTransaction as jest.Mock).mock.calls.map(call => call[1]).find(
        event => event.email_type === 'admin_notification'
      );
      expect(admin.body).toContain('new_receipt');
      expect(admin.body).not.toContain(CUSTOMER_GUIDANCE_MESSAGE);
    });
  });

  it('keeps the admin notification free of category and customer details', async () => {
    await createEstimate({
      ...SERVICE_PROFILE,
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
