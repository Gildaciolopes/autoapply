# Quickstart / Validation — Discovery & Scoring (F2)

Contracts: [rest-api.md](contracts/rest-api.md), [queues.md](contracts/queues.md). Model: [data-model.md](data-model.md).

## Prerequisites

F1 merged (verified facts exist), `make infra`, `make migrate`, `make test-db`, Ollama models, `make dev`
(api, worker, web, Python scraper).

## 1. Automated tests

```bash
pnpm test                                  # packages/jobs units, worker sources + process-run, api
cd services/scraper && uv run pytest -q    # JobSpy row mapping + return-value contract
```

## 2. Preferences (US1)

Web `/vagas/preferencias`: "Sugerir do meu perfil" fills roles/stack/locations from facts; save. LinkedIn
toggle asks to accept the terms warning. `GET /preferences` returns what was saved.

## 3. Discovery (US2)

```bash
curl -s -X POST localhost:3001/discovery/runs          # → 202 {runId}
curl -s localhost:3001/discovery/runs/<runId> | jq .   # → status done, per-source counts
```
Bull Board shows the flow (`process-run` parent + `discover`/`discover-jobspy` children). Run twice:
second run reports duplicates, no new jobs beyond caps.

## 4. Scoring + feed (US3/US4)

Web `/vagas`: jobs ordered by score; cards show matched (with fact links) / missing skills and reasons;
"mostrar filtradas" shows filter reasons. Block a company from a card → its jobs disappear.

## 5. Eval (SC-005)

`make jobs-eval` → ≥ 8 of the top 10 of the 30 labelled fixture jobs are relevant (live models).
