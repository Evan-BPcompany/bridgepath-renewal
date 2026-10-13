import {
  BootstrapPool,
  BootstrapRefusal,
  bootstrapAdminPassword,
  findBootstrapTarget,
  validateBootstrapUsername
} from '../services/adminBootstrapService';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHARACTERS,
  PASSWORD_MIN_CHARACTER_TYPES,
  PasswordViolation,
  validateNewPassword
} from '../utils/passwordPolicy';
import type { Prompter } from '../utils/terminalPrompt';

export const MAX_PASSWORD_ATTEMPTS = 3;

export interface BootstrapCliDeps {
  env: Record<string, string | undefined>;
  // true only when both stdin and stdout are terminals; a hidden prompt needs a terminal.
  isInteractive: boolean;
  createPrompter(): Prompter;
  createPool(databaseUrl: string): BootstrapPool & { end(): Promise<void> };
  write(line: string): void;
  writeError(line: string): void;
}

const REFUSAL_MESSAGES: Record<BootstrapRefusal, (name: string) => string> = {
  NOT_FOUND: name => `No admin account named "${name}" exists. Nothing was changed.`,
  ALREADY_INITIALIZED: name =>
    `"${name}" has already changed its password (must_change_password is false). ` +
    'It will not be overwritten. Nothing was changed.',
  ACCOUNT_INACTIVE: name => `"${name}" is deactivated. Nothing was changed.`
};

const VIOLATION_MESSAGES: Record<PasswordViolation, string> = {
  TOO_SHORT: `shorter than ${PASSWORD_MIN_CHARACTERS} characters`,
  NOT_ENOUGH_CHARACTER_TYPES: `fewer than ${PASSWORD_MIN_CHARACTER_TYPES} character types`,
  CONTAINS_CONTROL_CHARACTERS: 'contains control characters',
  MATCHES_ACCOUNT_INFO: 'equals the username or the email of the account',
  MATCHES_DEFAULT_PASSWORD: 'equals the documented default password'
};

// Database errors can carry connection details, so only a short error code is ever shown.
function describeFailure(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const safeCode = typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'unknown';
  return `Could not complete the bootstrap (database error: ${safeCode}). Nothing was printed to protect secrets.`;
}

// Prompts for the account name and a hidden one-time password, then initializes the account.
// Returns the process exit code. It never prints the password, its hash or DATABASE_URL.
export async function runBootstrapCli(deps: BootstrapCliDeps): Promise<number> {
  const databaseUrl = deps.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.trim() === '') {
    deps.writeError('DATABASE_URL is not set. Aborting; nothing was changed.');
    return 1;
  }

  if (!deps.isInteractive) {
    deps.writeError(
      'This command needs an interactive terminal (the password is typed without echo and is never read from arguments, files or the environment). Aborting; nothing was changed.'
    );
    return 1;
  }

  const prompter = deps.createPrompter();
  let pool: (BootstrapPool & { end(): Promise<void> }) | null = null;

  try {
    const usernameCheck = validateBootstrapUsername(await prompter.ask('Admin username: '));
    if (!usernameCheck.ok) {
      deps.writeError(`${usernameCheck.reason} Nothing was changed.`);
      return 1;
    }
    const username = usernameCheck.username;

    pool = deps.createPool(databaseUrl);

    const target = await findBootstrapTarget(pool, username);
    if (!target.ok) {
      deps.writeError(REFUSAL_MESSAGES[target.refusal](username));
      return 1;
    }

    deps.write(
      `Password rules: at least ${PASSWORD_MIN_CHARACTERS} characters, at most ${PASSWORD_MAX_BYTES} bytes in UTF-8, ` +
        `and at least ${PASSWORD_MIN_CHARACTER_TYPES} of: lowercase, uppercase, digit, other.`
    );
    deps.write('The password is a one-time password: it must be changed at the first login.');

    let password: string | null = null;

    for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS && password === null; attempt += 1) {
      const first = await prompter.ask('One-time password (hidden): ', { hidden: true });
      const second = await prompter.ask('Repeat the password (hidden): ', { hidden: true });

      if (first !== second) {
        deps.writeError('The two entries do not match.');
        continue;
      }

      const policy = validateNewPassword(first, target.account);
      if (policy.ok) {
        password = first;
      } else if (policy.code === 'PASSWORD_TOO_LONG') {
        deps.writeError(`The password is longer than ${PASSWORD_MAX_BYTES} bytes in UTF-8.`);
      } else {
        deps.writeError(
          `The password was rejected: ${policy.violations.map(v => VIOLATION_MESSAGES[v]).join('; ')}.`
        );
      }
    }

    if (password === null) {
      deps.writeError('No valid password was entered. Nothing was changed.');
      return 1;
    }

    const outcome = await bootstrapAdminPassword(pool, { username, password });

    if (!outcome.ok) {
      if ('refusal' in outcome) {
        deps.writeError(REFUSAL_MESSAGES[outcome.refusal](username));
      } else if (outcome.error === 'PASSWORD_TOO_LONG') {
        deps.writeError(`The password is longer than ${PASSWORD_MAX_BYTES} bytes in UTF-8. Nothing was changed.`);
      } else {
        deps.writeError('The password was rejected by the password policy. Nothing was changed.');
      }
      return 1;
    }

    deps.write(`Bootstrap completed for admin "${outcome.username}".`);
    return 0;
  } catch (err) {
    if (err instanceof Error && err.message === 'INPUT_CLOSED') {
      deps.writeError('Cancelled. Nothing was changed.');
    } else {
      deps.writeError(describeFailure(err));
    }
    return 1;
  } finally {
    prompter.close();
    if (pool) {
      try {
        await pool.end();
      } catch {
        // Nothing useful to report; the exit code already reflects the result.
      }
    }
  }
}
