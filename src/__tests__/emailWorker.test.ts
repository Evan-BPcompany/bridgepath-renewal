jest.mock('../services/emailService', () => ({
  claimPendingEmailEvents: jest.fn(),
  recoverStaleEmailEvents: jest.fn(),
  markEmailSent: jest.fn(),
  scheduleEmailRetry: jest.fn()
}));

// The SendGrid client is replaced by a module mock: no request can ever be made.
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

import sgMail from '@sendgrid/mail';
import { config } from '../config/env';
import logger from '../utils/logger';
import {
  claimPendingEmailEvents,
  markEmailSent,
  recoverStaleEmailEvents,
  scheduleEmailRetry
} from '../services/emailService';
import {
  initializeEmailWorker,
  processPendingEmailEvents,
  startEmailWorkerLoop,
  stopEmailWorker
} from '../services/emailWorker';

const claim = claimPendingEmailEvents as jest.Mock;
const recover = recoverStaleEmailEvents as jest.Mock;
const markSent = markEmailSent as jest.Mock;
const retry = scheduleEmailRetry as jest.Mock;
const send = sgMail.send as unknown as jest.Mock;
const setApiKey = sgMail.setApiKey as unknown as jest.Mock;

const API_KEY = 'SG.test-only-not-a-real-key';

const event = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  recipient_email: `${id}@example.com`,
  subject: `Subject ${id}`,
  body: `<p>Body ${id}</p>`,
  retry_count: 0,
  ...overrides
});

describe('email worker', () => {
  const original = {
    key: config.sendgridApiKey,
    from: config.sendgridFromEmail,
    enabled: config.emailWorker.enabled,
    interval: config.emailWorker.intervalMs
  };

  beforeEach(() => {
    jest.clearAllMocks();
    claim.mockResolvedValue([]);
    recover.mockResolvedValue(undefined);
    markSent.mockResolvedValue(undefined);
    retry.mockResolvedValue(undefined);
    send.mockResolvedValue([{ statusCode: 202, headers: { 'x-message-id': 'msg-1' } }, {}]);

    config.sendgridApiKey = API_KEY;
    config.sendgridFromEmail = 'sender@example.com';

    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    stopEmailWorker();
    jest.useRealTimers();
    jest.restoreAllMocks();
    config.sendgridApiKey = original.key;
    config.sendgridFromEmail = original.from;
    config.emailWorker.enabled = original.enabled;
    config.emailWorker.intervalMs = original.interval;
  });

  describe('processPendingEmailEvents', () => {
    it('recovers stale events first, then claims up to 10 events', async () => {
      const order: string[] = [];
      recover.mockImplementation(async () => {
        order.push('recover');
      });
      claim.mockImplementation(async () => {
        order.push('claim');
        return [];
      });

      await processPendingEmailEvents();

      expect(order).toEqual(['recover', 'claim']);
      expect(claim).toHaveBeenCalledWith(10);
      expect(send).not.toHaveBeenCalled();
    });

    it('sends each claimed event and marks it sent with the SendGrid message id', async () => {
      claim.mockResolvedValue([event('e1'), event('e2')]);
      send
        .mockResolvedValueOnce([{ headers: { 'x-message-id': 'msg-1' } }])
        .mockResolvedValueOnce([{ headers: { 'x-message-id': 'msg-2' } }]);

      await processPendingEmailEvents();

      expect(setApiKey).toHaveBeenCalledWith(API_KEY);
      expect(markSent.mock.calls).toEqual([
        ['e1', 'msg-1'],
        ['e2', 'msg-2']
      ]);
      expect(retry).not.toHaveBeenCalled();
    });

    it('builds the message from the event: recipient, sender, subject, html, tracking off', async () => {
      claim.mockResolvedValue([event('e1')]);

      await processPendingEmailEvents();

      expect(send).toHaveBeenCalledWith({
        to: 'e1@example.com',
        from: 'sender@example.com',
        subject: 'Subject e1',
        html: '<p>Body e1</p>',
        trackingSettings: { clickTracking: { enable: false }, openTracking: { enable: false } }
      });
    });

    describe('without a SendGrid API key', () => {
      it('never pretends to send: no request, not marked sent, a retry is scheduled', async () => {
        config.sendgridApiKey = undefined;
        claim.mockResolvedValue([event('e1')]);

        await processPendingEmailEvents();

        expect(send).not.toHaveBeenCalled();
        expect(markSent).not.toHaveBeenCalled();
        expect(retry).toHaveBeenCalledWith('e1', expect.stringContaining('SendGrid API key not configured'));
      });

      it('also refuses when only the sender address is missing', async () => {
        config.sendgridFromEmail = undefined;
        claim.mockResolvedValue([event('e1')]);

        await processPendingEmailEvents();

        expect(send).not.toHaveBeenCalled();
        expect(retry).toHaveBeenCalledWith('e1', 'SendGrid API key or from email not configured');
      });
    });

    describe('failures while sending', () => {
      const failWith = async (error: unknown) => {
        claim.mockResolvedValue([event('e1')]);
        send.mockRejectedValue(error);
        await processPendingEmailEvents();
      };

      it('schedules a retry with a generic "SendGrid API error" text', async () => {
        await failWith(new Error('Unauthorized'));

        expect(retry).toHaveBeenCalledWith('e1', 'SendGrid API error: Unauthorized');
        expect(markSent).not.toHaveBeenCalled();
      });

      it('cuts long error texts to 100 characters', async () => {
        await failWith(new Error('x'.repeat(500)));

        const message = retry.mock.calls[0][1] as string;
        expect(message).toBe(`SendGrid API error: ${'x'.repeat(100)}`);
      });

      it('names an invalid recipient and an authentication failure specifically', async () => {
        await failWith(new Error('Invalid email address'));
        await failWith(new Error('Authentication failed for this key'));

        expect(retry.mock.calls[0][1]).toBe('Invalid recipient email address');
        expect(retry.mock.calls[1][1]).toBe('SendGrid authentication failed - check API key');
      });

      it('treats an empty answer and a missing message id as failures', async () => {
        claim.mockResolvedValue([event('e1')]);

        send.mockResolvedValueOnce([]);
        await processPendingEmailEvents();
        send.mockResolvedValueOnce([{ headers: {} }]);
        await processPendingEmailEvents();

        expect(retry.mock.calls[0][1]).toBe('SendGrid API error: Empty response from SendGrid');
        expect(retry.mock.calls[1][1]).toBe('SendGrid API error: No message ID in SendGrid response');
        expect(markSent).not.toHaveBeenCalled();
      });

      it('survives a non-Error rejection', async () => {
        await failWith('plain string failure');

        expect(retry).toHaveBeenCalledWith('e1', 'SendGrid API error: plain string failure');
      });
    });

    describe('isolation and resilience', () => {
      it('keeps processing the other events when one of them fails to be recorded', async () => {
        claim.mockResolvedValue([event('e1'), event('e2')]);
        markSent.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
        send
          .mockResolvedValueOnce([{ headers: { 'x-message-id': 'msg-1' } }])
          .mockResolvedValueOnce([{ headers: { 'x-message-id': 'msg-2' } }]);

        await expect(processPendingEmailEvents()).resolves.toBeUndefined();

        // The first send succeeded but could not be recorded: it is retried (at-least-once delivery).
        expect(retry).toHaveBeenCalledWith('e1', expect.any(String));
        expect(markSent).toHaveBeenCalledWith('e2', 'msg-2');
      });

      it('keeps going when scheduling a retry itself fails', async () => {
        claim.mockResolvedValue([event('e1'), event('e2')]);
        send.mockRejectedValue(new Error('boom'));
        retry.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);

        await expect(processPendingEmailEvents()).resolves.toBeUndefined();

        expect(retry).toHaveBeenCalledTimes(2);
      });

      it('does not throw when claiming fails', async () => {
        claim.mockRejectedValue(new Error('db down'));

        await expect(processPendingEmailEvents()).resolves.toBeUndefined();
        expect(send).not.toHaveBeenCalled();
      });

      it('does not claim anything when recovering fails, and does not throw', async () => {
        recover.mockRejectedValue(new Error('db down'));

        await expect(processPendingEmailEvents()).resolves.toBeUndefined();
        expect(claim).not.toHaveBeenCalled();
      });
    });
  });

  describe('worker loop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      config.emailWorker.intervalMs = 30000;
    });

    it('does not start when disabled', async () => {
      config.emailWorker.enabled = false;

      initializeEmailWorker();
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(claim).not.toHaveBeenCalled();
    });

    it('polls every interval once started', async () => {
      config.emailWorker.enabled = true;

      initializeEmailWorker();
      expect(claim).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(30000);
      expect(claim).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60000);
      expect(claim).toHaveBeenCalledTimes(3);
    });

    it('warns about the missing API key but still starts (events stay queued)', async () => {
      config.emailWorker.enabled = true;
      config.sendgridApiKey = undefined;

      initializeEmailWorker();
      await jest.advanceTimersByTimeAsync(30000);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SENDGRID_API_KEY is not set'));
      expect(claim).toHaveBeenCalledTimes(1);
    });

    it('never runs two loops: starting twice keeps a single timer', async () => {
      startEmailWorkerLoop();
      startEmailWorkerLoop();

      await jest.advanceTimersByTimeAsync(30000);

      expect(claim).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('Email worker loop is already running');
    });

    it('stops polling when stopped, and stopping again is harmless', async () => {
      startEmailWorkerLoop();
      await jest.advanceTimersByTimeAsync(30000);
      expect(claim).toHaveBeenCalledTimes(1);

      stopEmailWorker();
      stopEmailWorker();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(claim).toHaveBeenCalledTimes(1);
    });

    it('a failing tick does not stop the loop', async () => {
      claim.mockRejectedValueOnce(new Error('db down')).mockResolvedValue([]);
      startEmailWorkerLoop();

      await jest.advanceTimersByTimeAsync(60000);

      expect(claim).toHaveBeenCalledTimes(2);
    });

    it('can be started again after being stopped', async () => {
      startEmailWorkerLoop();
      stopEmailWorker();
      startEmailWorkerLoop();

      await jest.advanceTimersByTimeAsync(30000);

      expect(claim).toHaveBeenCalledTimes(1);
    });
  });
});
