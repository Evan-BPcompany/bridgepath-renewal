import { config } from '../config/env';
import logger from '../utils/logger';
import { CODE_TTL_MS } from '../utils/customerAccount';
import { sendEmailViaSendGrid } from './emailWorker';

export type CodePurpose = 'signup' | 'password_reset';

export class MailUnavailableError extends Error {
  constructor() {
    super('Mail is not configured');
    this.name = 'MailUnavailableError';
  }
}

const TEXT: Record<CodePurpose, { subject: string; lead: string }> = {
  signup: { subject: '[Bridge Path] 회원가입 인증코드', lead: '회원가입을 계속하려면 아래 인증코드를 입력해 주세요.' },
  password_reset: {
    subject: '[Bridge Path] 비밀번호 재설정 인증코드',
    lead: '비밀번호를 다시 설정하려면 아래 인증코드를 입력해 주세요.'
  }
};

// The codes are sent at once, not through the e-mail outbox: a code that arrives after a retry
// minutes later is already useless, and the code must not stay in a table of sent mails.
// Without SendGrid, development prints the code to the console of the server (never in production,
// where this throws and the customer is told to try again later).
export async function sendCodeEmail(to: string, purpose: CodePurpose, code: string): Promise<void> {
  const text = TEXT[purpose];
  const minutes = Math.round(CODE_TTL_MS / 60000);

  if (config.sendgridApiKey && config.sendgridFromEmail) {
    const body =
      `<p>${text.lead}</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>` +
      `<p>인증코드는 ${minutes}분 동안 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>`;
    await sendEmailViaSendGrid(to, text.subject, body);
    return;
  }

  if (config.nodeEnv === 'production') {
    logger.error('Verification code not sent: SendGrid is not configured');
    throw new MailUnavailableError();
  }

  // The logger masks digits and addresses on purpose, so the development hint is written directly.
  process.stdout.write(`[dev] ${purpose} code for ${to}: ${code} (valid ${minutes} minutes; SendGrid is not configured)\n`);
}
