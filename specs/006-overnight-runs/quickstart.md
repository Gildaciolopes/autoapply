# Quickstart — Overnight runs (F6)

Prereqs: F1–F5 (verified facts, preferences with score threshold, mode `review`), `make dev`.
Optional: a Telegram bot (create it with @BotFather, put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
in `.env`).

1. `make test` — window math (midnight crossing, days, missed nights), tick state machine with a fake
   clock (one run per night, budget, window end → pending, step failure → partial, stop → stopped),
   report builder (no PII), Telegram command filter (only the configured chat), SSE replay without gaps,
   memory reuse/disable/conflict, review reject/estimate. Fixture sources and forms only; zero
   submissions.
2. Web `/noite` → turn on "Execução noturna", keep 23:00–06:59 → "Próxima execução" shows tonight.
   "Rodar agora" → the live view shows discovery → preparation events within seconds.
3. "Testar Telegram" → "AutoApply conectado" arrives on the phone. Send `status` → reply with the
   state; send `parar` → the header shows "Pausado"; `retomar` → resumes scheduling.
4. Morning: report message with counts and link → `/revisao` → select ready items → "Aprovar
   selecionadas" (summary shows per-platform estimate) → items go to "Enviando"/"Aguardando limite".
   Reject one with a reason → it never returns.
5. Edit an answer of a ready item → re-prepared; `/memoria` shows the new memory (origin "edição");
   disable it → the next preparation asks again.
6. "Parar tudo" during a run → run "Parada", nothing queued remains, next night does not start until
   "Retomar".
