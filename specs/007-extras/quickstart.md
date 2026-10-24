# Quickstart: Extras (F7)

Validation guide. Contracts: [rest-api.md](contracts/rest-api.md), [mcp-tools.md](contracts/mcp-tools.md),
[queues.md](contracts/queues.md). Entities: [data-model.md](data-model.md).

## Prerequisites

- `make infra`, `make migrate`, Ollama running (`make models`).
- `SESSION_ENCRYPTION_KEY` set (64 hex) — Gmail tokens are encrypted with it.
- For Gmail (optional): Google Cloud Console → new project → enable Gmail API → OAuth consent screen
  "External", status Testing, add your address as test user → Credentials → OAuth client ID type
  **Desktop app** → put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.

## Automated

```bash
make test           # analytics cohort/splits, reply match + classify (fake LLM), mail check idempotency
                    # (fake Gmail fetch), outcome recompute, MCP tools via SDK client over HTTP
make typecheck && make lint
make replies-eval   # 30 labelled synthetic emails on the live LLM → link/type accuracy, EvalRun `replies`
```

Expected: all green; `replies-eval` link accuracy ≥ 90%, type accuracy ≥ 85%, 0 unrelated stored
(SC-002). Tests make zero calls to Google and zero writes to any mailbox.

## Manual scenarios

1. **Analytics** — `make dev`, open `/analises`: funnel for 8 weeks; switch split source/platform/
   week and check buckets add up to totals; empty period shows zeros and "—".
2. **Gmail connect** — `/integracoes` → "Conectar Gmail" → Google consent in your browser (you sign
   in yourself) → back with "conectado". Screen shows only the read-only permission.
3. **Reply tracking** — "Verificar agora": replies for submitted applications appear in `/respostas`
   and on `/vagas/<id>/candidatura` timeline; fix a wrong type; register a manual reply; check
   `/analises` replied/interview counts move.
4. **Disconnect** — "Desconectar": status `disconnected`, no more checks; existing replies stay.
5. **MCP (read)** — `claude mcp add --transport http autoapply http://127.0.0.1:3001/mcp`, then ask
   "o que tem na minha fila de revisão?" → same counts as `/revisao`.
6. **MCP (actions)** — ask "pare tudo" → header shows Pausado; resume in the web. Enable "Permitir
   aprovar pelo assistente" in `/integracoes`, ask to approve two named ready applications → the
   assistant shows the preview; confirm → exactly those two are approved (they are sent by the F5
   path within caps). Asking to "aprovar todas" is refused.
7. **Local only** — `curl -H 'Host: evil.example' http://127.0.0.1:3001/mcp` → refused.
