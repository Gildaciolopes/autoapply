# Queue — `apply` (existing name)

Payload `ApplyPayload { applicationId, attempt }` (application pre-created by the API in `queued`).
Consumer: worker `ApplyProcessor`, concurrency 1, attempts 2 (exponential backoff 30 s) for
page/network errors only; blockers / needs_input are final results, not errors.

Steps (each emits `RunEvent(queue:'apply', applicationId)`): cap check → ensure tailored docs (inline
F3) → open dry-run context (R1) → detect ATS → locate form (+ iframe) → blockers → screenshot
`before` → extract fields (adapter + generic, per step) → answer (R4) → fill + attach → screenshot
per step / `after` → persist answers, artifacts, reasons, report, factsHash → status
`ready | needs_input | failed`. Between steps the processor re-reads the application and aborts if
`skipped` (kill switch).
