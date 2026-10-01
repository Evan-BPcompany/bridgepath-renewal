import { config } from '../config/env';
import logger from '../utils/logger';
import {
  claimPendingEmailEvents,
  recoverStaleEmailEvents,
  markEmailSent,
  scheduleEmailRetry,
  EmailEvent
} from './emailService';

let workerInterval: NodeJS.Timeout | null = null;

/**
 * Initialize and start email worker
 * Only starts if EMAIL_WORKER_ENABLED=true and SENDGRID_API_KEY is set
 */
export function initializeEmailWorker(): void {
  if (!config.emailWorker.enabled) {
    logger.info('Email worker is disabled');
    return;
  }

  if (!config.sendgridApiKey) {
    logger.warn(
      'Email worker is enabled but SENDGRID_API_KEY is not set. ' +
      'Worker will not send actual emails. Set SENDGRID_API_KEY in .env to enable.'
    );
  }

  startEmailWorkerLoop();
}

/**
 * Start the email worker loop
 */
export function startEmailWorkerLoop(): void {
  if (workerInterval !== null) {
    logger.warn('Email worker loop is already running');
    return;
  }

  logger.info('Starting email worker loop', {
    interval_ms: config.emailWorker.intervalMs,
    stale_timeout_ms: config.emailWorker.staleTimeoutMs
  });

  workerInterval = setInterval(() => {
    processPendingEmailEvents().catch(err => {
      logger.error('Email worker error', {
        error: err instanceof Error ? err.message : String(err)
      });
    });
  }, config.emailWorker.intervalMs);
}

/**
 * Stop the email worker loop (for testing/graceful shutdown)
 */
export function stopEmailWorker(): void {
  if (workerInterval !== null) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info('Email worker loop stopped');
  }
}

/**
 * Main worker function: claim, send, and update
 * Two-stage approach:
 * Stage A: Claim events with short DB transaction (FOR UPDATE SKIP LOCKED)
 * Stage B: Send and update results outside transaction
 */
export async function processPendingEmailEvents(): Promise<void> {
  try {
    // Recover stale events that were stuck in sending state
    await recoverStaleEmailEvents();

    // Stage A: Claim pending events (short DB transaction)
    const events = await claimPendingEmailEvents(10);

    if (events.length === 0) {
      return;
    }

    logger.info('Claimed email events for processing', { count: events.length });

    // Stage B: Process each event outside transaction
    for (const event of events) {
      try {
        await processEmailEventStageB(event);
      } catch (err) {
        logger.error('Failed to process email event', {
          event_id: event.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  } catch (err) {
    logger.error('Error in processPendingEmailEvents', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Stage B: Send email via SendGrid and update status
 * Runs outside of DB transaction to avoid holding locks during API calls
 */
async function processEmailEventStageB(event: EmailEvent): Promise<void> {
  try {
    // API key required for actual sending
    if (!config.sendgridApiKey) {
      const errorMsg = 'SendGrid API key not configured. Email not sent. Set SENDGRID_API_KEY to enable email delivery.';
      logger.warn('Skipping email send (no API key)', {
        event_id: event.id,
        reason: errorMsg
      });

      // Schedule retry so email is not lost
      // Will remain in pending state until API key is configured and worker is restarted
      await scheduleEmailRetry(event.id, errorMsg);
      return;
    }

    // Send via SendGrid
    const messageId = await sendEmailViaSendGrid(
      event.recipient_email,
      event.subject,
      event.body
    );

    // Mark as sent
    await markEmailSent(event.id, messageId);
    logger.info('Email sent successfully', {
      event_id: event.id,
      message_id: messageId,
      retry_count: event.retry_count
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to send email, scheduling retry', {
      event_id: event.id,
      error: errorMessage,
      retry_count: event.retry_count
    });

    // Schedule retry
    await scheduleEmailRetry(event.id, errorMessage);
  }
}

/**
 * Send email via SendGrid API
 * Throws on failure to trigger retry logic
 */
async function sendEmailViaSendGrid(
  to: string,
  subject: string,
  body: string
): Promise<string> {
  if (!config.sendgridApiKey || !config.sendgridFromEmail) {
    throw new Error('SendGrid API key or from email not configured');
  }

  // Dynamic import to avoid dependency issues in test environment
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(config.sendgridApiKey);

  const msg = {
    to,
    from: config.sendgridFromEmail,
    subject,
    html: body,
    // Disable click tracking to avoid modifying links
    trackingSettings: {
      clickTracking: {
        enable: false
      },
      openTracking: {
        enable: false
      }
    }
  };

  try {
    const response = await sgMail.send(msg);

    // Extract message ID from SendGrid response
    // SendGrid returns array of responses, we need first one
    if (!response || response.length === 0) {
      throw new Error('Empty response from SendGrid');
    }

    const messageId = response[0].headers?.['x-message-id'];
    if (!messageId) {
      throw new Error('No message ID in SendGrid response');
    }

    return messageId;
  } catch (err) {
    // Don't log sensitive data like API key or error details that might contain config
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Check for specific SendGrid errors
    if (errorMsg.includes('Invalid email')) {
      throw new Error(`Invalid recipient email: ${to}`);
    }
    if (errorMsg.includes('Authentication failed')) {
      throw new Error('SendGrid authentication failed - check API key');
    }

    throw new Error(`SendGrid API error: ${errorMsg.substring(0, 100)}`);
  }
}
