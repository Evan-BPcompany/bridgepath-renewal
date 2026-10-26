# Deployment checklist

For the first deployment, and for every one after it. **Nothing has been deployed yet, and none of the outside services has ever been called from this code** (Heroku, AWS S3, SendGrid, Google, Kakao, the Claude API): the code is tested against fakes and against a local PostgreSQL. Expect the first real run to find small things, and keep this list open while you do it.

Two helpers check what they can:

```bash
npm run predeploy:check -- [--front [config.js]] [--db] [--env-file <file>]   # the settings, before starting
npm run front:files                                                          # the files of the customer pages to publish
```

`predeploy:check` prints `FAIL` (the server will not start, or a feature is broken), `WARN` (works, but read it) and `ok`. It never prints the value of a secret. Exit code 1 when anything fails. It needs the build (`npm run build`).

## 0. What to have ready

| What | Why |
|---|---|
| **A domain you own** (for example `example.com`) | The customer pages and the API have to be on **one site** (`www.example.com` and `api.example.com`), or nobody can stay signed in. Names such as `*.netlify.app` and `*.herokuapp.com` are public suffixes: two of them are two sites. |
| Heroku account, with the PostgreSQL add-on | The API, the admin screen (`/admin-ui/`) and the database. Check that the plan keeps **backups**: this project makes none. |
| A static web host for the customer pages (any host that lets you use your own domain with https) | The pages are plain files (`npm run front:files`); the API does not serve them. |
| AWS account: one private S3 bucket and one IAM user | Attached files of the requests. |
| SendGrid account, with the sender (or the domain) verified | The e-mail code to sign up, and every notice. |
| Anthropic API key | The photo analysis of the AI quote. Optional: without it the price range still works. |
| Google OAuth client, Kakao app | Optional: without them the two buttons are hidden and e-mail sign-up works. |
| **An approved privacy consent text** | Production accepts **no** request and no sign-up until one is approved. Needs a legal review. |
| The staff e-mail for notices, a support e-mail | `ADMIN_NOTIFICATION_EMAIL`, `SUPPORT_EMAIL`. |

## 1. The layout

```
 customer's browser
   ├── https://www.example.com   customer pages (static files, config.js says where the API is)
   └── https://api.example.com   Heroku: the API (/api), the admin screen (/admin-ui/), /admin
                                   ├── PostgreSQL (Heroku add-on, TLS)
                                   ├── S3 (files)           SendGrid (e-mail)
                                   ├── Claude API (photos)  Google / Kakao (sign-in)
```

- Both addresses are **https**. The cookies are `Secure` in production, and a page on http would not get them.
- The cookie of a signed-in customer is set by the API and sent by the browser to the API from a page of the **same site**. If the pages and the API are on different sites, sign-in appears to work and then nobody is signed in. `predeploy:check` fails for this (`same-site`).
- The admin screen is served by the API itself, at `https://api.example.com/admin-ui/`; the admin cookies are `SameSite=Strict`, so it must be opened there.
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
| `CORS_ORIGINS` | yes | The origin of the customer pages, `https://www.example.com` (no `*`, no path, several separated by commas). |
| `FRONTEND_BASE_URL` | yes | Same origin: where the browser returns after Google/Kakao, and where the links in e-mails go. |
| `PUBLIC_API_URL` | yes | `https://api.example.com`: the address that is registered with Google and Kakao. |
| `FILE_STORAGE` | yes | `s3` (the default). `local` is refused in production. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | yes | The bucket and the IAM user of section 3. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | yes | The key and the verified sender. Without them nobody can sign up. |
| `EMAIL_WORKER_ENABLED` | yes | `true`, or the receipts, quote notices and answers are never sent. |
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

**Domain.** Point `www` to the static host and `api` to the Heroku app (Heroku: add the custom domain to the app, then the DNS record it gives you; its automatic certificate takes some minutes).

**S3.** One bucket in one region, **block all public access**, no public policy. One IAM user with a policy that allows `s3:PutObject` on `arn:aws:s3:::<bucket>/*` (and `s3:DeleteObject`, which the code uses to undo a request that failed after its files were stored). Nothing else. Put the key pair in the settings. (There is no download from the site yet.)

**SendGrid.** Create an API key that may send mail only. Verify the sender address, or better the whole domain (the DNS records it asks for), so that the codes do not land in spam. `SENDGRID_FROM_EMAIL` must be that sender.

**Google.** In the Cloud Console create an OAuth client of the type "web application". Authorized redirect URI, exactly: `https://api.example.com/api/customers/oauth/google/callback`. The consent screen: scopes `openid`, `email`, `profile`; while it is in "testing" only the listed test users can sign in, so **publish** it before opening to customers. Put the id and the secret in the settings.

**Kakao.** In the Kakao developers console create the app, switch on Kakao Login, and register the Redirect URI, exactly: `https://api.example.com/api/customers/oauth/kakao/callback`. The sign-in asks for the e-mail (`account_email`) and the nickname; **the e-mail item needs the business app review** (a registered business). Without the e-mail the sign-in is refused on purpose: the customer is told to use e-mail sign-up. Put the REST API key in `KAKAO_CLIENT_ID`.

**Anthropic.** Create a key in the console and set a monthly spending limit there. Every photo analysis costs money, which is why it has the tightest limit of the API (10 an hour per IP).

**The privacy consent.** Save the approved text as `docs/privacy-consent/<version>.md`, add the version to `APPROVED_CONSENT_VERSIONS` in `src/config/privacyConsent.ts`, and put the **same** version in `config.js` of the pages. A unit test checks that the text exists for each version.

## 4. The first deployment, in order

1. **Prepare the code.** The consent version (section 3), then `npm test`. Commit.
2. **Heroku.** Create the app, add the PostgreSQL add-on, set the settings of section 2 (`heroku config:set ...`). Add the custom domain.
3. **Deploy** (`git push heroku <branch>:main`). Heroku runs `npm run build` and `npm start`. There is no `Procfile`; the `start` script is used.
4. **Check the settings on the server**, which sees the real ones:
   ```bash
   heroku run npm run predeploy:check
   ```
   Fix every `FAIL`. Read every `WARN`.
5. **Migrate the database** (`001` to `018`). The migration tool (`knex`, `ts-node`) is a development dependency that Heroku removes after the build, so run it **from your own machine**, against the production database:
   ```powershell
   # PowerShell: take the address of the database from Heroku; do not write it into a file
   $env:DATABASE_URL = (heroku config:get DATABASE_URL -a <app>)
   $env:DATABASE_SSL_REJECT_UNAUTHORIZED = "false"
   npx knex migrate:latest --env production
   Remove-Item Env:DATABASE_URL
   ```
   Take a **backup first** (`heroku pg:backups:capture`). Then, on the server: `heroku run npm run predeploy:check -- --db` (reads the migrations, the prices and the admin accounts; changes nothing).
6. **The first admin account:** `heroku run npm run admin:bootstrap` (interactive; sets a one-time password that has to be changed at the first login). Until then the seeded account cannot be used.
7. **Publish the customer pages.** `npm run front:files` lists the files. Put them on the static host, with **`config.js` replaced** by the production one: `API_BASE: 'https://api.example.com'` and `PRIVACY_CONSENT_VERSION` of the approved text. Check it before you upload:
   ```bash
   npm run predeploy:check -- --front config.js
   ```
   (From your machine this also complains about settings that only the server has; read only the lines of `front-`.)
8. **Register the redirect addresses** at Google and Kakao (section 3), if you use them.
9. **Smoke test** (section 5), with the real services.

## 5. The smoke test after a deployment

Do it with a test e-mail address and a test phone number; delete or ignore the records afterwards.

- [ ] `GET https://api.example.com/health` answers `ok` (it does not prove the database is up).
- [ ] `https://api.example.com/admin-ui/`: sign in, change the password, see the list (empty is fine).
- [ ] The customer pages open on `https://www.example.com`, over https, with no failed request in the console (a failed one to `localhost` means `config.js` is the development one).
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
- **Migrations cannot run on the server** (see step 5); the tool should be compiled or moved to the dependencies.
- **Admin accounts** can only be made by the bootstrap command; there is no screen to add a staff member or to switch one off.
- **KakaoTalk notices** (the receipt, the quote, the answer) are planned, not built: they need a Kakao business channel, a sending agency and a separate consent to receive messages.
- **Never run for real:** S3, SendGrid, Google, Kakao, the Claude API, Heroku, the real custom domains and certificates.

## 8. Every later deployment

1. `npm test`; for a change of the database also `npm run test:integration` on a local PostgreSQL.
2. Backup, then migrate (step 5), then deploy (step 3), in that order: the new code expects the new tables.
3. `heroku run npm run predeploy:check -- --db`.
4. If the pages changed: `npm run front:files`, publish, keep the production `config.js`.
5. A short smoke test (section 5): at least sign-in, a request, an e-mail.
