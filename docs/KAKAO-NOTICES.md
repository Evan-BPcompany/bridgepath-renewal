# KakaoTalk notices (Alimtalk)

**Status (2026-10-26): prepared, not connected.** The code writes the notices and has a worker; nothing can be sent to Kakao yet, because no sending agency is connected. The switch `KAKAO_NOTIFY_ENABLED` is off, and the server **refuses to start in production with it on** (only the `log` provider exists: it writes the message to the log, without the whole number, and sends nothing).

## What the code does

| | |
|---|---|
| Who gets a notice | A signed-in customer who **ticked the KakaoTalk box** (sign-up, the completion page after Google/Kakao sign-in, or the box at the bottom of "내 견적"), has a **Korean mobile number** (010…, +82 forms accepted, a landline or a foreign number gets none) and an active account. Someone who sent a request without an account gets none. |
| When | The request is received (`receipt`); the staff publishes or changes the detailed quote (`quote_published`); the staff answers a question (`inquiry_answered`). |
| How | A row in `kakao_events`, written **in the same transaction** as the thing it tells about (so either both exist or neither), once per event (`idempotency_key`). A worker sends it every 30 s (`KAKAO_WORKER_INTERVAL_MS`), retries after 1, 2 and 4 minutes, then leaves it `failed`; a worker that died mid-send is recovered after 5 minutes. Done rows are deleted after 90 days (failed: 180). |
| What it says | Fixed texts (`src/utils/kakaoMessage.ts`), each with only the receipt number filled in, and a button with a link to "내 견적". **No amount and nothing of the quote.** |
| Consent | `customers.kakao_notify_consent_at`, a separate consent from the privacy one, off by default, taken back with one click in "내 견적" (`POST /api/customers/me/kakao-notify`). |

## What you have to do (outside the code)

1. **A KakaoTalk Business channel** for the company (Kakao Business, needs the business registration). It must be linked to the sender profile of the agency.
2. **A sending agency** with an Alimtalk API (several Korean companies sell this; compare the price per message, the API and the support). Open an account; the API key will be a secret like the others (never in the project or in a chat).
3. **The three templates approved by Kakao.** Submit the texts of `KAKAO_TEMPLATES` as they are (the place is `#{receipt_id}`; the button is a web link to the "내 견적" page, which must be the real address). Kakao may ask for changes: then change the text **in the code** too, so that the two stay equal.
4. **Tell the customers** what they agree to: the wording next to the box (now: "카카오톡으로 접수·견적 알림을 받겠습니다. (선택)") and the privacy text should say that the phone number is used for it and passed to the agency.
5. Then ask for the last piece: **a sender for that agency** (`KakaoSender` in `src/services/kakaoService.ts`, one method `send`), the setting that selects it, and a smoke test with a real phone. Until then production stays off.

## Known limits

- A request sent **without** an account has no consent on record, so no notice goes out even if the form had a phone number.
- The phone number is stored as the customer typed it; it is normalised when the notice is written. Nobody checks that the number belongs to the customer (no SMS code).
- The notices are not shown in the admin screen yet; look at `kakao_events` (status, `last_error`).
