// The checks that `npm run predeploy:check` runs before a deployment. No network, no database and no
// file here: the settings come in as a plain object, so the checks can be tested and so that this
// file never needs the application's own configuration (which refuses to load when it is wrong).
//
// A value of a secret is never put in a message: only whether it is there, and what is wrong with it.

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  level: CheckLevel;
  title: string;
  // What is wrong and what to do; empty for an ok.
  detail: string;
}

export type Env = Record<string, string | undefined>;

export interface DeployInput {
  env: Env;
  // The consent versions that production accepts (src/config/privacyConsent.ts).
  approvedConsentVersions: readonly string[];
  // The text of config.js of the front end, when it is to be checked too.
  frontConfigSource?: string;
}

const result = (id: string, level: CheckLevel, title: string, detail = ''): CheckResult => ({ id, level, title, detail });
const ok = (id: string, title: string): CheckResult => result(id, 'ok', title);

const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== '';
const text = (env: Env, name: string): string => (env[name] ?? '').trim();

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const isLocalHost = (host: string): boolean => LOCAL_HOSTS.includes(host) || host.endsWith('.localhost') || host.endsWith('.local');

// ---------------------------------------------------------------------------------------------
// "The same site": the cookie of a signed-in customer is sent to the API only when the pages and the API
// belong to one registrable domain (www.example.com and api.example.com do; xyz.netlify.app and
// abc.herokuapp.com do not, because those are public suffixes of their own).

const PUBLIC_SUFFIXES = new Set([
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr', 'pe.kr', 'hs.kr', 'ms.kr', 'es.kr',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'com.cn', 'com.br', 'co.nz', 'com.sg', 'com.hk', 'com.tw',
  // Hosting platforms that give every customer a name under their own domain.
  'herokuapp.com', 'vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'workers.dev', 'onrender.com', 'fly.dev',
  'web.app', 'firebaseapp.com', 'cloudfront.net', 'amazonaws.com', 'azurewebsites.net', 'appspot.com', 'railway.app', 'surge.sh'
]);

export function registrableDomain(host: string): string {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(':') || !name.includes('.')) {
    return name; // an address or a name without a dot is its own site
  }
  const labels = name.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = PUBLIC_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

interface ParsedOrigin {
  url: URL;
  problem?: string;
}

// An origin as the configuration wants it: http(s), no path, no query.
function parseOrigin(raw: string): ParsedOrigin | null {
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash) {
      return { url, problem: 'must be an address without a path, a query or a fragment' };
    }
    return { url };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------

function checkCore(env: Env): CheckResult[] {
  const out: CheckResult[] = [];

  if (text(env, 'NODE_ENV') !== 'production') {
    out.push(result('node-env', 'fail', 'NODE_ENV is not "production"', 'Set NODE_ENV=production. Without it the server keeps its development defaults (no TLS to the database, test consent version).'));
  } else {
    out.push(ok('node-env', 'NODE_ENV=production'));
  }

  const secret = env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    out.push(result('jwt-secret', 'fail', 'JWT_SECRET is missing or shorter than 32 characters', 'The server refuses to start. Make a random one (for example 48 random bytes in base64) and set it only in the hosting settings.'));
  } else if (/(change|secret|demo|example|password|test|dev)/i.test(secret) || new Set(secret).size < 8) {
    out.push(result('jwt-secret', 'warn', 'JWT_SECRET looks like a placeholder', 'It has a word such as "secret", "demo" or "change", or too few different characters. Use a random value; whoever knows it can make admin sessions.'));
  } else {
    out.push(ok('jwt-secret', 'JWT_SECRET is set and long enough'));
  }

  if (text(env, 'COOKIE_SECURE') !== 'true') {
    out.push(result('cookie-secure', 'fail', 'COOKIE_SECURE is not "true"', 'The server refuses to start in production: the cookies of admins and customers would travel over plain HTTP.'));
  } else {
    out.push(ok('cookie-secure', 'COOKIE_SECURE=true'));
  }

  const proxy = text(env, 'TRUST_PROXY');
  if (proxy !== '' && !/^\d+$/.test(proxy)) {
    out.push(result('trust-proxy', 'fail', 'TRUST_PROXY is not a whole number', 'Use the number of proxies in front of the app (Heroku: 1). Never "true".'));
  } else if (proxy !== '' && Number(proxy) > 10) {
    out.push(result('trust-proxy', 'fail', 'TRUST_PROXY is above 10', 'Use the number of proxies in front of the app (Heroku: 1).'));
  } else if (proxy === '' || Number(proxy) === 0) {
    out.push(result('trust-proxy', 'warn', 'TRUST_PROXY is 0', 'Behind a hosting proxy every customer looks like the proxy: the limits of 10 requests an hour would be shared by ALL customers. Heroku: TRUST_PROXY=1.'));
  } else {
    out.push(ok('trust-proxy', `TRUST_PROXY=${proxy}`));
  }

  return out;
}

function checkDatabase(env: Env): CheckResult[] {
  const out: CheckResult[] = [];
  const url = text(env, 'DATABASE_URL');

  if (url === '') {
    out.push(result('database-url', 'fail', 'DATABASE_URL is not set', 'There is no default database. The hosting add-on normally sets it.'));
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')) {
      out.push(result('database-url', 'fail', 'DATABASE_URL is not a PostgreSQL address', 'It has to start with postgres:// or postgresql://.'));
    } else if ([...parsed.searchParams.keys()].some(key => /^(ssl|sslmode|sslcert|sslkey|sslrootcert|uselibpqcompat)$/i.test(key))) {
      out.push(result('database-url', 'fail', 'DATABASE_URL has an ssl parameter', 'The server refuses to start in production: DATABASE_SSL and DATABASE_SSL_REJECT_UNAUTHORIZED decide the TLS, not the address.'));
    } else if (isLocalHost(parsed.hostname)) {
      out.push(result('database-url', 'warn', 'DATABASE_URL points to this machine', 'Production should use the hosted database.'));
    } else {
      out.push(ok('database-url', 'DATABASE_URL is a PostgreSQL address on another machine'));
    }
  }

  if (text(env, 'DATABASE_SSL').toLowerCase() === 'false') {
    out.push(result('database-ssl', 'fail', 'DATABASE_SSL=false', 'The server refuses to start in production: the connection to the database has to be encrypted.'));
  } else if (text(env, 'DATABASE_SSL_REJECT_UNAUTHORIZED').toLowerCase() === 'false') {
    out.push(result('database-ssl', 'warn', 'The certificate of the database is not verified', 'DATABASE_SSL_REJECT_UNAUTHORIZED=false encrypts the connection but does not check who is at the other end. Heroku PostgreSQL needs it today; use a CA certificate when the plan gives one.'));
  } else {
    out.push(ok('database-ssl', 'The connection to the database is encrypted and verified'));
  }

  return out;
}

function checkAddresses(env: Env): CheckResult[] {
  const out: CheckResult[] = [];

  // ---- CORS_ORIGINS
  const corsRaw = text(env, 'CORS_ORIGINS');
  const cors = corsRaw.split(',').map(item => item.trim()).filter(Boolean);
  let corsBad = false;
  if (cors.length === 0) {
    out.push(result('cors', 'fail', 'CORS_ORIGINS is not set', 'It defaults to http://localhost:3000. Set the address(es) of the customer pages, for example https://www.example.com.'));
    corsBad = true;
  } else {
    for (const origin of cors) {
      const parsed = origin.includes('*') ? null : parseOrigin(origin);
      if (!parsed || parsed.problem) {
        out.push(result('cors', 'fail', `CORS_ORIGINS has an entry that is not an origin: ${origin.replace(/[^\x20-\x7e]/g, '?').slice(0, 60)}`, 'A full address with https://, no *, no path, for example https://www.example.com.'));
        corsBad = true;
      } else if (isLocalHost(parsed.url.hostname)) {
        out.push(result('cors', 'fail', `CORS_ORIGINS has a local address: ${parsed.url.origin}`, 'Remove the development addresses; production serves the customer pages from the real domain.'));
        corsBad = true;
      } else if (parsed.url.protocol !== 'https:') {
        out.push(result('cors', 'fail', `CORS_ORIGINS has an address without https: ${parsed.url.origin}`, 'Cookies are secure-only in production: the pages have to be on https.'));
        corsBad = true;
      }
    }
  }
  if (!corsBad) {
    out.push(ok('cors', 'CORS_ORIGINS are https addresses of the real domain'));
  }

  // ---- the two addresses that the sign-in with Google/Kakao needs
  const frontRaw = text(env, 'FRONTEND_BASE_URL');
  const apiRaw = text(env, 'PUBLIC_API_URL');
  let front: URL | null = null;
  let api: URL | null = null;

  if (frontRaw === '') {
    out.push(result('frontend-url', 'warn', 'FRONTEND_BASE_URL is not set', 'It then defaults to the first CORS_ORIGINS entry. Set it, so that the return from Google/Kakao and the link in the e-mails go to the right page.'));
    const firstOrigin = cors[0] ? parseOrigin(cors[0]) : null;
    front = firstOrigin && !firstOrigin.problem ? firstOrigin.url : null;
  } else {
    const parsed = parseOrigin(frontRaw);
    if (!parsed || parsed.problem) {
      out.push(result('frontend-url', 'fail', 'FRONTEND_BASE_URL is not an origin', 'A full address with https://, no path, for example https://www.example.com. The server refuses to start.'));
    } else if (isLocalHost(parsed.url.hostname) || parsed.url.protocol !== 'https:') {
      out.push(result('frontend-url', 'fail', 'FRONTEND_BASE_URL is local or not https', 'The links in the e-mails to customers and the return from Google/Kakao would go there.'));
    } else {
      front = parsed.url;
      out.push(ok('frontend-url', 'FRONTEND_BASE_URL is an https address'));
    }
  }

  if (apiRaw === '') {
    out.push(result('public-api-url', 'fail', 'PUBLIC_API_URL is not set', 'It defaults to http://localhost:<PORT>. Set the public address of this API, for example https://api.example.com: Google and Kakao send the customer back to it.'));
  } else {
    const parsed = parseOrigin(apiRaw);
    if (!parsed || parsed.problem) {
      out.push(result('public-api-url', 'fail', 'PUBLIC_API_URL is not an origin', 'A full address with https://, no path, for example https://api.example.com. The server refuses to start.'));
    } else if (isLocalHost(parsed.url.hostname) || parsed.url.protocol !== 'https:') {
      out.push(result('public-api-url', 'fail', 'PUBLIC_API_URL is local or not https', 'Google and Kakao accept only the redirect address that is registered with them.'));
    } else {
      api = parsed.url;
      out.push(ok('public-api-url', 'PUBLIC_API_URL is an https address'));
    }
  }

  // ---- the same site
  if (front && api) {
    const a = registrableDomain(front.hostname);
    const b = registrableDomain(api.hostname);
    if (a !== b) {
      out.push(
        result(
          'same-site',
          'fail',
          `The pages (${a}) and the API (${b}) are not on the same site`,
          'The cookie of a signed-in customer is sent to the API only from a page of the same site (for example www.example.com and api.example.com). With different sites nobody could stay signed in. Give both a name under one domain of yours; sites such as *.netlify.app and *.herokuapp.com do not count as one.'
        )
      );
    } else {
      out.push(ok('same-site', `The pages and the API are on one site (${a})`));
    }

    const others = cors
      .map(origin => parseOrigin(origin))
      .filter((item): item is ParsedOrigin => Boolean(item) && !item!.problem)
      .filter(item => registrableDomain(item.url.hostname) !== registrableDomain(api!.hostname));
    if (others.length > 0) {
      out.push(result('cors-same-site', 'warn', 'A CORS origin is on another site than the API', 'Customers on that origin cannot sign in (the cookie is not sent). Remove it, or move it under the same domain.'));
    }
  }

  return out;
}

function checkServices(env: Env): CheckResult[] {
  const out: CheckResult[] = [];

  // ---- files
  const storage = text(env, 'FILE_STORAGE') || 's3';
  if (storage === 'local') {
    out.push(result('file-storage', 'fail', 'FILE_STORAGE=local', 'The server refuses to start in production: files kept on the server are lost with it. Use s3.'));
  } else if (storage !== 's3') {
    out.push(result('file-storage', 'fail', 'FILE_STORAGE is neither "s3" nor "local"', 'Use s3.'));
  } else {
    const missing = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET'].filter(name => !present(env[name]));
    out.push(
      missing.length > 0
        ? result('file-storage', 'fail', `S3 is not set up: ${missing.join(', ')} missing`, 'Without it a request with attached files is refused (the request is saved with all of its files or not at all).')
        : ok('file-storage', 'Files go to S3 (the settings are there; the connection has never been tried from here)')
    );
  }
  if (text(env, 'FILE_DOWNLOAD_ENABLED').toLowerCase() === 'true') {
    out.push(result('file-download', 'fail', 'FILE_DOWNLOAD_ENABLED=true', 'The server refuses to start: downloads of customer files stay blocked until virus scanning and a download provider exist.'));
  }

  // ---- e-mail
  const sendgridMissing = ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'].filter(name => !present(env[name]));
  if (sendgridMissing.length > 0) {
    out.push(result('sendgrid', 'fail', `SendGrid is not set up: ${sendgridMissing.join(', ')} missing`, 'No customer could get the e-mail code to sign up (the server answers "e-mail unavailable"), and no receipt or quote notice would be sent.'));
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(env, 'SENDGRID_FROM_EMAIL'))) {
    out.push(result('sendgrid', 'fail', 'SENDGRID_FROM_EMAIL is not an e-mail address', 'Use the sender that you verified at SendGrid.'));
  } else {
    out.push(ok('sendgrid', 'SendGrid key and sender are set (never tried from here)'));
  }
  if (text(env, 'EMAIL_WORKER_ENABLED').toLowerCase() !== 'true') {
    out.push(result('email-worker', 'fail', 'EMAIL_WORKER_ENABLED is not "true"', 'The e-mails of receipts, quotes and answers wait in the outbox and are never sent. (The sign-up code is sent at once and does not need it.)'));
  } else {
    out.push(ok('email-worker', 'The e-mail worker is on'));
  }
  if (!present(env.ADMIN_NOTIFICATION_EMAIL)) {
    out.push(result('admin-mail', 'warn', 'ADMIN_NOTIFICATION_EMAIL is not set', 'The staff are not told by e-mail of new requests, questions and requests for a consultation (the inbox still shows them).'));
  }
  if (!present(env.SUPPORT_EMAIL)) {
    out.push(result('support-mail', 'warn', 'SUPPORT_EMAIL is not set', 'The e-mails to customers then have no address to ask at.'));
  }

  // ---- photo analysis
  if (!present(env.ANTHROPIC_API_KEY)) {
    out.push(result('anthropic', 'warn', 'ANTHROPIC_API_KEY is not set', 'The photo analysis of the AI quote is unavailable; the price range and the rest work.'));
  } else {
    out.push(ok('anthropic', 'The key of the photo analysis is set'));
  }

  // ---- Google and Kakao
  const googleId = present(env.GOOGLE_CLIENT_ID);
  const googleSecret = present(env.GOOGLE_CLIENT_SECRET);
  if (googleId && !googleSecret) {
    out.push(result('google', 'fail', 'GOOGLE_CLIENT_ID is set without GOOGLE_CLIENT_SECRET', 'The server refuses to start.'));
  } else if (!googleId) {
    out.push(result('google', 'warn', 'Google sign-in is off', 'No GOOGLE_CLIENT_ID: the Google button is hidden. Sign-up by e-mail works.'));
  } else {
    out.push(ok('google', 'Google sign-in is set (the redirect address has to be registered at Google)'));
  }
  if (!present(env.KAKAO_CLIENT_ID)) {
    out.push(result('kakao', 'warn', 'Kakao sign-in is off', 'No KAKAO_CLIENT_ID: the Kakao button is hidden. Sign-up by e-mail works.'));
  } else {
    out.push(ok('kakao', 'Kakao sign-in is set (the redirect address has to be registered at Kakao)'));
  }

  // ---- what is read but not used
  if (present(env.SENTRY_DSN)) {
    out.push(result('sentry', 'warn', 'SENTRY_DSN is set but Sentry is not integrated', 'Nothing is sent to it: there is no error alerting yet.'));
  }

  return out;
}

function checkConsent(approved: readonly string[]): CheckResult[] {
  if (approved.length === 0) {
    return [
      result(
        'consent',
        'fail',
        'No privacy consent version is approved',
        'Production answers 503 to every estimate request and sign-up until a version is approved: save the approved text as docs/privacy-consent/<version>.md, add the version to APPROVED_CONSENT_VERSIONS (src/config/privacyConsent.ts) and set the same version in config.js of the front end.'
      )
    ];
  }
  return [ok('consent', `A privacy consent version is approved (${approved.join(', ')})`)];
}

// ---------------------------------------------------------------------------------------------
// config.js of the front end: what it says is sent to every visitor.

export function readFrontConfig(source: string): { apiBase?: string; consentVersion?: string } {
  const string = (name: string): string | undefined => new RegExp(`${name}\\s*:\\s*(['"])([^'"]*)\\1`).exec(source)?.[2];
  return { apiBase: string('API_BASE'), consentVersion: string('PRIVACY_CONSENT_VERSION') };
}

function checkFront(source: string, env: Env, approved: readonly string[]): CheckResult[] {
  const out: CheckResult[] = [];
  const { apiBase, consentVersion } = readFrontConfig(source);

  if (!apiBase) {
    out.push(result('front-api-base', 'fail', 'config.js has no API_BASE', 'The pages would not know where the API is.'));
  } else {
    const parsed = parseOrigin(apiBase);
    if (!parsed || parsed.problem || isLocalHost(parsed.url.hostname) || parsed.url.protocol !== 'https:') {
      out.push(result('front-api-base', 'fail', 'API_BASE of config.js is local or not an https address', 'Replace config.js when you publish the pages: API_BASE has to be the public address of the API, with no slash at the end.'));
    } else if (present(env.PUBLIC_API_URL) && parseOrigin(text(env, 'PUBLIC_API_URL'))?.url.origin !== parsed.url.origin) {
      out.push(result('front-api-base', 'warn', 'API_BASE of config.js differs from PUBLIC_API_URL', 'They should be the same address.'));
    } else {
      out.push(ok('front-api-base', 'API_BASE of config.js is the https address of the API'));
    }
  }

  if (!consentVersion) {
    out.push(result('front-consent', 'fail', 'config.js has no PRIVACY_CONSENT_VERSION', 'The pages would send no consent version and every request would be refused.'));
  } else if (approved.length > 0 && !approved.includes(consentVersion)) {
    out.push(result('front-consent', 'fail', `PRIVACY_CONSENT_VERSION of config.js ("${consentVersion.slice(0, 30)}") is not an approved version`, 'Use the version that is in APPROVED_CONSENT_VERSIONS: production refuses any other.'));
  } else if (approved.length === 0) {
    out.push(result('front-consent', 'warn', 'The consent version of config.js cannot be checked: none is approved', 'See the check "No privacy consent version is approved".'));
  } else {
    out.push(ok('front-consent', 'PRIVACY_CONSENT_VERSION of config.js is an approved version'));
  }

  return out;
}

// ---------------------------------------------------------------------------------------------

export function checkDeployment(input: DeployInput): CheckResult[] {
  return [
    ...checkCore(input.env),
    ...checkDatabase(input.env),
    ...checkAddresses(input.env),
    ...checkServices(input.env),
    ...checkConsent(input.approvedConsentVersions),
    ...(input.frontConfigSource !== undefined ? checkFront(input.frontConfigSource, input.env, input.approvedConsentVersions) : [])
  ];
}

export function summarize(results: CheckResult[]): { ok: number; warn: number; fail: number } {
  return {
    ok: results.filter(item => item.level === 'ok').length,
    warn: results.filter(item => item.level === 'warn').length,
    fail: results.filter(item => item.level === 'fail').length
  };
}

// ---------------------------------------------------------------------------------------------
// With --db: what the database says. The query function is given, so this is tested without one.

export type Query = (sql: string) => Promise<Array<Record<string, unknown>>>;

export async function checkDatabaseState(query: Query, migrationFiles: string[]): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const expected = migrationFiles.map(name => name.replace(/\.(ts|js)$/, '')).sort();

  try {
    const applied = (await query('SELECT name FROM knex_migrations ORDER BY id')).map(row => String(row.name).replace(/\.(ts|js)$/, ''));
    const pending = expected.filter(name => !applied.includes(name));
    const unknown = applied.filter(name => !expected.includes(name));
    if (pending.length > 0) {
      out.push(result('migrations', 'fail', `${pending.length} migration(s) are not applied: ${pending.join(', ')}`, 'Run the migrations before starting this version (npm run db:migrate:prod; Heroku does it before each release).'));
    } else if (unknown.length > 0) {
      out.push(result('migrations', 'warn', `The database has migrations that this version does not know: ${unknown.join(', ')}`, 'It was migrated by a newer version. Deploy that version, or check what ran.'));
    } else {
      out.push(ok('migrations', `All ${expected.length} migrations are applied`));
    }
  } catch {
    out.push(result('migrations', 'fail', 'The list of migrations could not be read', 'The database is not migrated yet, or this user may not read it.'));
    return out;
  }

  try {
    const prices = await query(`SELECT COUNT(*)::int AS n FROM base_prices WHERE category = 'eyewear' AND is_active = true AND description NOT LIKE '[SAMPLE]%'`);
    const n = Number(prices[0]?.n ?? 0);
    out.push(
      n >= 5
        ? ok('base-prices', `${n} real prices for sunglasses are in place`)
        : result('base-prices', 'warn', 'The real prices of sunglasses are not in the database', 'Migration 014 writes them; without them the AI quote shows the placeholder prices or none.')
    );
  } catch {
    out.push(result('base-prices', 'warn', 'The prices of sunglasses could not be read', ''));
  }

  try {
    const admins = await query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active AND NOT must_change_password)::int AS ready FROM admin_users`);
    const total = Number(admins[0]?.total ?? 0);
    const ready = Number(admins[0]?.ready ?? 0);
    if (total === 0) {
      out.push(result('admin-account', 'fail', 'There is no admin account', 'Run npm run admin:bootstrap.'));
    } else if (ready === 0) {
      out.push(result('admin-account', 'warn', 'No admin has set a password of their own yet', 'The seeded account has to be initialized (npm run admin:bootstrap) and its password changed at the first login.'));
    } else {
      out.push(ok('admin-account', `${ready} admin account(s) are ready`));
    }
  } catch {
    out.push(result('admin-account', 'warn', 'The admin accounts could not be read', ''));
  }

  return out;
}
