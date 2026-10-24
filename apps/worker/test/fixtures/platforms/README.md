# Synthetic platform fixtures (F5)

The agent that built F5 may not create accounts or log in to real platforms, so these pages are
**synthetic**: they reproduce the public structure of the Gupy application flow and the LinkedIn Easy
Apply modal (labels, button texts, step navigation done by page script). Replace them with real
snapshots taken with your own session:

    cd apps/worker && pnpm exec tsx --env-file=../../.env scripts/snapshot-form.ts <url> <name> --session gupy

Snapshots taken with a session are written to `data/fixtures/<name>/` (gitignored) — review them for
personal data before moving them here.
