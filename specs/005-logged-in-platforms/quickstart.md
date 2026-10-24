# Quickstart — Logged-in platforms & assisted submission (F5)

Prereqs: F1–F4 (verified facts, tailored resumes), `SESSION_ENCRYPTION_KEY` in `.env` (`make setup`
generates it), `make dev`, Playwright Chromium. Mode `review` in preferences.

1. `make test` — crypto, Gupy/LinkedIn adapters on synthetic fixtures (dry-run), submit path against
   a local recording test form (submits once, form changed blocks, kill switch, uncertain, idempotent,
   assisted), caps/interval/pause, API approval rules.
2. Web `/plataformas` → "Conectar Gupy" → log in in the window that opens → "Concluí" → status
   "conectada"; "Testar sessão" → "válida". LinkedIn: confirm the ToS warning first.
3. Gupy job → "Simular candidatura" → "pronto para enviar" (screenshots per step).
4. `/candidaturas` → "Pronto" → open → "Aprovar e enviar" → status "enviada" with confirmation
   screenshot (real submission: only with your approval).
5. Form with captcha at submit → a window opens filled; complete the check and click submit yourself →
   "enviada (assistida)".
6. Caps: `/plataformas` shows today's usage; set Gupy submit cap to 1, approve 2 → second waits for
   tomorrow.
