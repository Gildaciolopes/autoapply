# Quickstart / Validation — Knowledge Base (F1)

Proves the feature end-to-end. Contracts: [rest-api.md](contracts/rest-api.md),
[queue-sync-profile.md](contracts/queue-sync-profile.md). Model: [data-model.md](data-model.md).

## Prerequisites

- `make infra` healthy, `make migrate` applied (includes `knowledge_base` migration), `make health` all up.
- Ollama models pulled (`make models`).
- `.env`: `GITHUB_TOKEN` (fine-grained, read-only), `GITHUB_USER`.
- Optional LinkedIn: `make linkedin-login` then `make linkedin-up`.
- `make dev` running (api :3001, worker, web :3000).

## 1. Automated tests (no network, fixtures only)

```bash
make test-db   # once: creates + migrates autoapply_test
pnpm test      # turbo, serial (api + worker share the test DB)
```

Expected: all green. Covers: `factKey`/merge/conflict rules, `foundInSource`, date parsing, GitHub
snapshot → skill evidence, sync diff (two snapshots → expected added/conflicted/missing, 0 verified
facts modified), renderer 1 page + `atsLint` score 100 on fixture persona, overflow fixture → `overflow`.

## 2. Resume import (US1)

```bash
curl -s -F 'file=@packages/resume/test/fixtures/persona-ana.pdf;type=application/pdf' localhost:3001/kb/resumes   # → 202 {id}
curl -s localhost:3001/kb/resumes/<id> | jq .status                                       # → "review" in ~2–2.5 min (qwen3:8b)
```
In web `/conhecimento/curriculo/<id>`: original left, draft right, flagged items highlighted. Edit a
title, confirm. `GET /kb/facts?origin=resume` → every item verified, edited title stored, each with a
`resume:` source ref.

Edge: upload a scanned fixture (`persona-scan.pdf`) → status `image_only`; retry with `vision` → `review`.
Upload a `.png` → `415`.

## 3. Personal facts (US2)

`PUT /kb/personal` with salary only → `GET /kb/personal` shows `pcd: "not_provided"` (never `no`).

## 4. Render (US3)

```bash
curl -s -X POST localhost:3001/kb/render -H 'content-type: application/json' -d '{}' -o /tmp/cv.pdf -D - | grep -i x-
curl -s -X POST localhost:3001/kb/render/lint -H 'content-type: application/json' -d '{}' | jq .score   # → 100
```
Expected `X-Pages: 1` and `X-Ats-Score: 100`. Reading order and text bullets are part of the lint
(`reading_order`, `text_bullets` checks) and of `packages/resume/test/render.test.ts`.

Extraction quality against the live model (SC-002): `make kb-eval` (~12 min, 5 personas).

## 5. GitHub (US4)

`POST /kb/sources/github/import` → `GET /kb/sync-runs` shows `success`; `GET /kb/facts?origin=github&kind=skill`
→ unverified skills, each with `github:<owner/repo>:<file>` refs and `repoCount`, `lastActivity`.

## 6. LinkedIn (US5, optional)

With `enabled=false`: `POST /kb/sources/linkedin/import` → `409 source_disabled`, and no MCP call
in logs. Enable, import → items equal to resume facts add a `linkedin:` source (no duplicates);
differing values appear in `GET /kb/conflicts`.

## 7. Conflicts (US6)

Resolve one with `choose`: fact verified, conflict `resolved`, rejected value in revisions.
Before resolving, `POST /kb/render` excludes that fact.

## 8. Sync (US7)

`POST /kb/sync` twice → two `manual` runs. Bull Board shows scheduler `sync-profile-daily`.
Verified facts unchanged (compare `updatedAt` before/after).
