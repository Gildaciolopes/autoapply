# Queue — `tailor` (existing name)

Payload `TailorPayload { jobId, documentIds: string[] }` (documents pre-created by API in `queued`).
Consumer: worker `TailorProcessor`, concurrency 1, attempts 2 (LLM transient errors).
Steps per document: load usable facts → rank (resume) → generate sentences (LLM) → substitute
computed placeholders → validate → retry once with findings → persist status/validation/factsHash →
`RunEvent(queue:'tailor')`.
Auto-tailor: `process-run` (F2) enqueues one job per selected top job when `autoTailor` is on.
