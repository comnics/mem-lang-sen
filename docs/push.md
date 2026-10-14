# M6 Push Notifications

M6 adds optional web push reminders for the daily learning queue. The server sends only a generic reminder that `/today` has work ready; notification payloads never include sentence text, answers, hints, or personal progress details.

## Runtime behavior

- `GET /api/v1/push-subscriptions` returns the user's notification preference, VAPID public key, configured flag, quiet hours, and registered devices.
- `POST /api/v1/push-subscriptions` saves a browser Push API subscription for the current user. Endpoints must be HTTPS and belong to the supported browser push providers.
- `PATCH /api/v1/push-subscriptions` updates `{ enabled, quietStart, quietEnd }`.
- `DELETE /api/v1/push-subscriptions` removes the current user's subscription endpoint.
- `POST /api/jobs/dispatch` is the cron entrypoint. It requires `Authorization: Bearer $JOB_TRIGGER_SECRET`.

The dispatch job is fail-closed unless all of these are true:

- `PUSH_ENABLED=true`
- `APP_ENV=production` or `APP_ENV=staging`
- `VERCEL_ENV` is not `preview`
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set
- In staging, the user UUID appears in comma-separated `PUSH_STAGING_USER_IDS`
- `JOB_TRIGGER_SECRET` is at least 32 characters for the HTTP job route

## Scheduling rules

The scheduler reuses the existing daily learning queue. A notification is eligible only when the user's study plan says today is a study day, the plan's local time has passed, the request is still within the two-hour notification window, quiet hours are not active, the user has due or active daily work, the global plan is not paused, and enrolled sets are still published and not paused.

Each device has one delivery record per local study date. Unique keys and claim leases prevent concurrent workers from normally sending the same delivery. Push transport is at-least-once: a process crash after provider acceptance but before the database commit can cause a retry. Notifications use a stable tag so the browser can replace the same reminder; exactly-once external delivery is not guaranteed.

## Delivery safety

Pending or expired-lease deliveries are claimed with a short database lease using `FOR UPDATE SKIP LOCKED`, then network sends happen outside the database transaction. Successful sends require the original lease token before marking the row `SENT`. Each batch sends at most five deliveries with an eight-second network timeout per delivery. Before each send, current user, subscription, preference, pause, quiet hours, queue and expiry are rechecked. Expired subscriptions from push providers (`404` or `410`) disable that subscription. Rate limits and transient provider failures retry with capped exponential backoff up to five attempts.

## Supabase cron

Use `scripts/platform/cron.sql` as the deployment template. It schedules a five-minute Supabase Cron job using `pg_net` and Vault placeholders. Store the app origin and job secret in Vault or inject equivalent values through your deployment process; do not commit real secrets.

The SQL follows the official [Supabase scheduling example](https://supabase.com/docs/guides/functions/schedule-functions): read named values from `vault.decrypted_secrets`; keep the view restricted to database administrators. `supabase_vault`, `pg_cron`, and `pg_net` must be available.
