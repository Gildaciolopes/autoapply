# Quickstart — Tailoring (F3)

Prereqs: F1 + F2 data (verified facts, a scored job), `make dev`, Ollama models.

1. `pnpm test` — validator rules + seeded cases (SC-002), ranking, placeholders, worker processor
   with recorded LLM outputs, API lifecycle.
2. Web `/vagas/<id>` → "Adaptar currículo" → wait (~1–3 min) → review screen `/vagas/<id>/curriculo`:
   base vs tailored diff, summary with citations, hide/restore items, edit summary (invalid claims
   blocked), approve, download PDF (1 page, ATS lint unchanged).
3. Job text with "carta de apresentação" → letter generated; else "Gerar carta" on demand.
4. `make eval` → trap suite report (recorded by default in CI; `TAILOR_EVAL_LIVE=1` live) → expect
   0 fabrications; result stored in `EvalRun`, visible at `GET /eval/runs`.
