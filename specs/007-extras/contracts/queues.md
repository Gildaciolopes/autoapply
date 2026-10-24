# Queues — Extras

| Queue | Job | Payload | Producer → Consumer | Notes |
|---|---|---|---|---|
| `mail` (new) | `mail-check` | `MailCheckPayload {}` | job scheduler every 30 min (worker boot) + `POST /mail/check` → worker `mail.processor` | concurrency 1; no-op unless `MailAccount.status = connected`; `attempts: 1` (next tick retries) |

Unchanged: `notify` (`report` now may include `mail_expired` alert and reply counts), `night`.

Name in `packages/shared/src/queues.ts` (`QUEUES.mail = 'mail'`).
