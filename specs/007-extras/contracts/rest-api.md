# REST API — Extras (`apps/api`)

Errors keep the existing shape `{ error: { code, message } }`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/analytics/funnel` | `?weeks=1–52 (8)&split=source\|platform\|week` | `FunnelView`; `400` schema |
| GET | `/mail` | — | `MailAccountView` (`configured=false` when `GOOGLE_CLIENT_ID/SECRET` missing) |
| GET | `/mail/connect` | — | `302` to Google consent (scope `gmail.readonly`, PKCE); `409 not_configured`; `409 no_encryption_key` |
| GET | `/mail/oauth/callback` | `?code&state` (or `?error`) | `302` to `WEB_ORIGIN/integracoes?mail=connected\|denied\|error`; state mismatch/expired → `error` |
| POST | `/mail/disconnect` | — | `200 MailAccountView` (revoke at Google best-effort, tokens deleted) |
| POST | `/mail/check` | — | `202 { queued: true }` ("Verificar agora"); `409 not_connected` |
| GET | `/replies` | `?review=true&applicationId=` | `ReplyView[]` (newest first; with job title/company) |
| GET | `/applications/:id/replies` | — | `ReplyView[]` (timeline) |
| POST | `/applications/:id/replies` | `ManualReplyBody { type, receivedAt, note? }` | `201 ReplyView`; `409 not_submitted` (only submitted / submit_uncertain / already_applied) |
| PATCH | `/replies/:id` | `ReplyPatchBody { type?, applicationId?, needsReview? }` | `200 ReplyView` (sets `userEdited`, recomputes both applications); `409 not_submitted` for target |
| DELETE | `/replies/:id` | — | `204` (recomputes application; the message id stays processed) |
| GET | `/assistant/settings` | — | `{ approveEnabled, url }` (`url` = `http://127.0.0.1:<port>/mcp`) |
| PUT | `/assistant/settings` | `{ approveEnabled: boolean }` | `200 { approveEnabled, url }` |
| ALL | `/mcp` | MCP Streamable HTTP | see `mcp-tools.md`; `403 not_local` for non-loopback peers |

`ApplicationView` (F4/F5) gains `outcome`, `firstReplyAt`, `interviewAt`, `preparedAt`.

Schemas in `packages/shared/src/analytics.ts` and `packages/shared/src/replies.ts` (see data-model.md).
