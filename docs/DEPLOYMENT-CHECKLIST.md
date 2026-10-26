# Deployment checklist

For the first deployment, and for every one after it. **Nothing has been deployed yet, and none of the outside services has ever been called from this code** (Heroku, AWS S3, SendGrid, Google, Kakao, the Claude API): the code is tested against fakes and against a local PostgreSQL. Expect the first real run to find small things, and keep this list open while you do it.

Two helpers check what they can:

```bash
npm run predeploy:check -- [--front [config.js]] [--db] [--env-file <file>]   # the settings, before starting
npm run front:files                                                          # the files of the customer pages (the server serves exactly these)
```

`predeploy:check` prints `FAIL` (the server will not start, or a feature is broken), `WARN` (works, but read it) and `ok`. It never prints the value of a secret. Exit code 1 when anything fails. It needs the build (`npm run build`).

## 0. What to have ready

| What | Why |
|---|---|
| **A domain you own** (yours is `bptrade.co.kr`, see 0a) | One name for the service, for example `app.bptrade.co.kr`. |
| Heroku account, with the PostgreSQL add-on | The customer pages, the API, the admin screen (`/admin-ui/`) and the database. Check that the plan keeps **backups**: this project makes none. |
| AWS account: one private S3 bucket and one IAM user | Attached files of the requests. |
| SendGrid account, with the sender (or the domain) verified | The e-mail code to sign up, and every notice. |
| Anthropic API key | The photo analysis of the AI quote. Optional: without it the price range still works. |
| Google OAuth client, Kakao app | Optional: without them the two buttons are hidden and e-mail sign-up works. |
| **An approved privacy consent text** | Production accepts **no** request and no sign-up until one is approved. Needs a legal review. |
| The staff e-mail for notices, a support e-mail | `ADMIN_NOTIFICATION_EMAIL`, `SUPPORT_EMAIL`. |

## 0a. One address for everything

The server (Heroku) serves the customer pages **and** the API **and** the admin screen from **one address**, for example `https://app.example.com`. So there is no second host to publish to, no CORS and no "same site" problem, and `config.js` is written by the server (`API_BASE` empty, the consent version of the approved text). Only the files that the pages use are served (the list of `npm run front:files`), never `package.json`, the source or the documents.

- **Point a name at Heroku:** `heroku domains:add app.example.com`, then a `CNAME` record for `app` to the target that Heroku prints, at the place where the DNS of the domain is kept. Heroku issues the https certificate itself.
- **The company homepage is a separate thing.** The existing site on `bptrade.co.kr` (a Cafe24 managed WordPress hosting, which cannot run this server: it has PHP and MariaDB, not Node.js and PostgreSQL) is left as it is. It is not part of this deployment; decide later whether it links to the quote service. Its term ends on 2026-11-18 with no automatic extension: extend it, or the site goes away. The domain has its own end date.
- If the pages are ever put on another host again, `config.js` has to be the production one there (`API_BASE` = the address of the server) and the host must be on the same site as the API (see the checks of `predeploy:check --front`).

## 1. The layout

```
 customer's browser
   └── https://app.example.com   Heroku: the customer pages (/), the API (/api), the admin screen (/admin-ui/)
                                   ├── PostgreSQL (Heroku add-on, TLS)
                                   ├── S3 (files)           SendGrid (e-mail)
                                   ├── Claude API (photos)  Google / Kakao (sign-in)
```

- The address is **https**. The cookies are `Secure` in production, and a page on http would not get them.
- The pages and the API are on the same address, so the cookie of a signed-in customer is first-party. (Were the pages on another host, they would have to be on the same site as the API, or sign-in appears to work and then nobody is signed in; `predeploy:check` fails for this, `same-site`.)
- The admin screen is served by the same server, at `https://app.example.com/admin-ui/`; the admin cookies are `SameSite=Strict`, so it must be opened there.
- One server process only (see section 7): the rate limits and the e-mail worker live in the process.

## 2. The settings

Set secrets in the hosting settings (`heroku config:set NAME=value`), never in a file of the project. `.env.example` lists them all.

| Name | Needed | What to put |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `JWT_SECRET` | yes | 32+ random characters, for example 48 random bytes in base64. Whoever knows it can make admin sessions. |
| `COOKIE_SECURE` | yes | `true` (the server refuses to start otherwise) |
| `TRUST_PROXY` | yes | `1` on Heroku. Never `true`. |
| `DATABASE_URL` | yes | Set by the PostgreSQL add-on. No `?sslmode=` in it. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | on Heroku | `false` (the certificate is not signed by a public CA): encrypted, not verified. A warning is normal. |
| `CORS_ORIGINS` | yes | The origin of the service, `https://app.example.com` (no `*`, no path, several separated by commas). The pages and the API are on one address, so it is the same as `FRONTEND_BASE_URL`. |
| `FRONTEND_BASE_URL` | yes | Same origin: where the browser returns after Google/Kakao, and where the links in e-mails go. |
| `PUBLIC_API_URL` | yes | `https://app.example.com`: the address that is registered with Google and Kakao. |
| `FILE_STORAGE` | yes | `s3` (the default). `local` is refused in production. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | yes | The bucket and the IAM user of section 3. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | yes | The key and the verified sender. Without them nobody can sign up. |
| `EMAIL_WORKER_ENABLED` | yes | `true`, or the receipts, quote notices and answers are never sent. |
| `CLEANUP_ENABLED` | no | Leave it unset (on): the daily deletion of expired sessions and old e-mails. `false` switches it off. |
| `ADMIN_NOTIFICATION_EMAIL` | recommended | Told of each new request, question and request for a consultation. |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE` | recommended | Shown in the e-mails to customers. |
| `ANTHROPIC_API_KEY` | optional | The photo analysis. `IMAGE_ANALYSIS_MODEL` to change the model. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Both, or neither. |
| `KAKAO_CLIENT_ID` (+ `KAKAO_CLIENT_SECRET` if you switched it on) | optional | The REST API key of the Kakao app. |
| `FILE_DOWNLOAD_ENABLED` | no | Leave unset: downloads of customer files stay blocked until virus scanning exists. |
| `SENTRY_DSN` | no | Read and ignored: Sentry is not integrated. |

The limits of the rate limiters have defaults (`*_RATE_LIMIT_*`, see the README); leave them.

## 3. The outside services

Menu names change; look for the same thing under the new name.

**Domain.** Point `app` to the Heroku app (Heroku: add the custom domain to the app, then the DNS record it gives you; its automatic certificate takes some minutes).

**S3.** One bucket in one region, **block all public access**, no public policy. One IAM user with a policy that allows `s3:PutObject` on `arn:aws:s3:::<bucket>/*` (and `s3:DeleteObject`, which the code uses to undo a request that failed after its files were stored). Nothing else. Put the key pair in the settings. (There is no download from the site yet.)

**SendGrid.** Create an API key that may send mail only. Verify the sender address, or better the whole domain (the DNS records it asks for), so that the codes do not land in spam. `SENDGRID_FROM_EMAIL` must be that sender.

**Google.** In the Cloud Console create an OAuth client of the type "web application". Authorized redirect URI, exactly: `https://app.example.com/api/customers/oauth/google/callback`. The consent screen: scopes `openid`, `email`, `profile`; while it is in "testing" only the listed test users can sign in, so **publish** it before opening to customers. Put the id and the secret in the settings.

**Kakao.** In the Kakao developers console create the app, switch on Kakao Login, and register the Redirect URI, exactly: `https://app.example.com/api/customers/oauth/kakao/callback`. The sign-in asks for the e-mail (`account_email`) and the nickname; **the e-mail item needs the business app review** (a registered business). Without the e-mail the sign-in is refused on purpose: the customer is told to use e-mail sign-up. Put the REST API key in `KAKAO_CLIENT_ID`.

**Anthropic.** Create a key in the console and set a monthly spending limit there. Every photo analysis costs money, which is why it has the tightest limit of the API (10 an hour per IP).

**The privacy consent.** Save the approved text as `docs/privacy-consent/<version>.md`, add the version to `APPROVED_CONSENT_VERSIONS` in `src/config/privacyConsent.ts`, (the server writes it into `config.js` of the pages by itself). A unit test checks that the text exists for each version.

## 4. The first deployment, in order

1. **Prepare the code.** The consent version (section 3), then `npm test`. Commit.
2. **Heroku.** Create the app, add the PostgreSQL add-on, set the settings of section 2 (`heroku config:set ...`). Add the custom domain.
3. **Deploy** (`git push heroku <branch>:main`). Heroku runs `npm run build`, then the `release` step of the `Procfile` (the migrations, step 5), then `npm start`. **On the very first deployment the database is empty and the release step creates all of it**, so set the settings (step 2) first: a release without `DATABASE_URL` stops.
4. **Check the settings on the server**, which sees the real ones:
   ```bash
   heroku run npm run predeploy:check
   ```
   Fix every `FAIL`. Read every `WARN`.
5. **Migrate the database** (`001` to `018`). **Heroku does it by itself**: the `release` line of the `Procfile` runs `npm run db:migrate:prod` before each new version goes live, with the compiled migrations of the build (`knexfile.production.js`; `knex` is a normal dependency for this reason). A migration that fails stops the release and the old version keeps running. Take a **backup first** (`heroku pg:backups:capture`). To look at it, or to run it by hand:
   ```bash
   heroku run npm run db:status:prod      # what is applied and what is not (changes nothing)
   heroku run npm run db:migrate:prod     # applies what is missing
   heroku run npm run predeploy:check -- --db
   ```
   **One rule:** a database is migrated with the compiled files **or** with the TypeScript ones of a developer's machine (`npm run db:migrate`), never both: knex records the file names, and `001_init_schema.ts` is not `001_init_schema.js`. A production database is only ever migrated with the compiled ones. (If it was done the other way by mistake, knex answers "migration directory is corrupt" and changes nothing.)
6. **The first admin account:** `heroku run npm run admin:bootstrap` (interactive; sets a one-time password that has to be changed at the first login). Until then the seeded account cannot be used.
7. **The customer pages need no publishing:** the server serves them (and writes `config.js`). Open `https://app.example.com/` and `/config.js` to see them.
8. **Register the redirect addresses** at Google and Kakao (section 3), if you use them.
9. **Smoke test** (section 5), with the real services.

## 5. The smoke test after a deployment

Do it with a test e-mail address and a test phone number; delete or ignore the records afterwards.

- [ ] `GET https://app.example.com/health` answers `ok` (it does not prove the database is up).
- [ ] `https://app.example.com/admin-ui/`: sign in, change the password, see the list (empty is fine).
- [ ] The customer pages open on `https://app.example.com`, over https, with no failed request in the console.
- [ ] **Sign-up by e-mail:** the code arrives (check spam), it signs you in, a wrong code is refused.
- [ ] **Stay signed in:** reload the page, open `my-quotes.html`: still signed in. (If not: the same-site rule, or `COOKIE_SECURE`.)
- [ ] **Google** and **Kakao** sign-in, if set up: you return to the page you came from; a new account is asked for the consent and the phone.
- [ ] **A request without sign-in** (the simple one) with a small attached file: a receipt number comes; the file is in the bucket; the staff e-mail arrives; the customer e-mail arrives.
- [ ] **The AI quote with a photo:** the analysis and the range show (the first call of the Claude API).
- [ ] **The detailed quote:** ask for it while signed in; on the admin screen write it with the contact, publish; the customer e-mail arrives; "내 견적" shows it with the contact.
- [ ] **A question and a request for a consultation** from "내 견적": the staff e-mail arrives, the inbox ("문의함") shows both, answer and close them; the customer sees the answer and gets the e-mail.
- [ ] The admin screen **cannot open an attached file** (blocked on purpose).
- [ ] After a few quick wrong sign-ins from one place, the answer is 429 (the limits work and `TRUST_PROXY=1` is right: other visitors are not blocked with you).
- [ ] The logs (`heroku logs --tail`) show no secret, no e-mail address in the text of an error, and a warning for the certificate of the database only.

## 6. Going back

- **The code:** deploy the previous commit (`heroku rollback`). Migrations are not undone by that.
- **The database:** `npm run db:rollback` undoes the last batch, with the protections described in [OPERATIONS.md](OPERATIONS.md) (several refuse to run while data would be lost). Restore the backup of step 5 for anything else.
- **A bad publication of the customer pages:** publish the previous files again; they are plain files.

## 7. Known gaps before a public opening

Not done, and worth a decision before real customers use it:

- **No monitoring.** Sentry is not integrated; logs on Heroku are not durable. Nobody is told when the server fails. Add a log drain with alerts, or integrate Sentry.
- **No backups of its own,** and a restore has never been tried. Use the plan's backups and **try a restore once**.
- **One process only.** The rate limits are counted in memory and the e-mail worker runs in the web process. With two dynos the limits double and two workers could race (the claim query is designed to prevent a double send; it has never been run against two workers).
- **Old rows are never removed:** expired sessions and e-mail codes, sent e-mail events. They are small, but there is no cleanup yet.
- **No virus scan,** so attached files are kept "quarantined" and cannot be opened by the staff. They have to ask the customer for a file by e-mail.
- **Customers' rights:** there is no way yet to delete an account, export a customer's data or answer a request to remove it; the privacy text has to say how that is done until there is.
- **No terms of service page,** only the privacy consent.
- **Admin accounts** can only be made by the bootstrap command; there is no screen to add a staff member or to switch one off.
- **KakaoTalk notices** (the receipt, the quote, the answer) are planned, not built: they need a Kakao business channel, a sending agency and a separate consent to receive messages.
- **Never run for real:** S3, SendGrid, Google, Kakao, the Claude API, Heroku, the real custom domains and certificates.

## 8. Every later deployment

1. `npm test`; for a change of the database also `npm run test:integration` on a local PostgreSQL.
2. Backup, then deploy: the release step migrates before the new code starts (step 5), so the new code never meets the old tables.
3. `heroku run npm run predeploy:check -- --db`.
4. The pages are part of the deployment (the same push); nothing else to publish.
5. A short smoke test (section 5): at least sign-in, a request, an e-mail.
