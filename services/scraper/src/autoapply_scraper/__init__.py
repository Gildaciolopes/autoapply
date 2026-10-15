"""Consumes `discover-jobspy` (child of a discovery flow) and returns a DiscoverResult. Queue names: packages/shared."""

import asyncio
import logging
import os
import signal

from bullmq import Worker

from . import jobspy_source
from .models import DiscoverResult, JobspyDiscoverPayload

DISCOVER_QUEUE = "discover-jobspy"

log = logging.getLogger("scraper")


async def run() -> None:
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6380")

    async def process(job, _token):
        payload = JobspyDiscoverPayload.model_validate(job.data)
        try:
            jobs = await asyncio.to_thread(jobspy_source.search, payload)
        except Exception as err:  # last attempt reports the failure as a result (FR-007)
            attempts = (job.opts or {}).get("attempts", 1)
            if job.attemptsMade + 1 < attempts:
                raise
            log.warning("jobspy %s %r failed: %s", payload.source, payload.query, err)
            return DiscoverResult(source=payload.source, jobs=[], error=str(err)[:200]).model_dump(exclude_none=True)
        log.info("jobspy %s %r → %d jobs", payload.source, payload.query, len(jobs))
        return DiscoverResult(source=payload.source, jobs=jobs).model_dump(exclude_none=True)

    worker = Worker(DISCOVER_QUEUE, process, {"connection": redis_url, "concurrency": 1})
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("scraper worker listening on %s", DISCOVER_QUEUE)
    await stop.wait()
    await worker.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    asyncio.run(run())
