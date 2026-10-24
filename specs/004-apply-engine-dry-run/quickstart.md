# Quickstart — Apply dry-run (F4)

Prereqs: F1–F3 data (verified facts, scored job with an apply URL on Greenhouse/Lever/Ashby),
`make dev`, Ollama models, Playwright Chromium.

1. `make test` — classifier/rules/blockers (pure), adapters + generic filler on offline form
   snapshots, dry-run guard (forced submit → 0 non-GET requests), answer traps with recorded LLM
   outputs, API lifecycle.
2. Web `/vagas/<id>` → "Simular candidatura" → `/vagas/<id>/candidatura`: before/after screenshots,
   per-field answers with source, confidence and cited facts; status "pronto para enviar".
3. A form with an unanswerable required question → status "precisa de você" listing it →
   answer in `/candidaturas?status=needs_input` → "Salvar e simular de novo" → field filled from
   memory.
4. `/candidaturas` → select jobs or "Top N" → batch → summary; "Parar tudo" stops (nothing submitted).
5. `make answers-eval` → answer trap suite live; expect 0 fabrications; `GET /eval/runs?suite=apply-answers`.
6. Proof (SC-001/002): `cd apps/worker && pnpm exec tsx --env-file=../../.env scripts/apply-proof.ts urls.txt`
   with 20 real public form URLs (≥ 5 each Greenhouse/Lever/Ashby) → local report; check screenshots
   in MinIO console and `report.submitAttempts = 0`, no allowed non-GET request.
