"""Consumes `discover-jobspy`, emits RawJob payloads to `normalize`. Queue names: packages/shared."""

import asyncio
import logging
import os
import signal

from bullmq import Queue, Worker

from . import jobspy_source
from .models import JobspyDiscoverPayload

DISCOVER_QUEUE = "discover-jobspy"
NORMALIZE_QUEUE = "normalize"

log = logging.getLogger("scraper")


async def run() -> None:
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6380")
    normalize = Queue(NORMALIZE_QUEUE, {"connection": redis_url})

    async def process(job, _token):
        payload = JobspyDiscoverPayload.model_validate(job.data)
        jobs = await asyncio.to_thread(jobspy_source.search, payload)
        for raw in jobs:
            await normalize.add("raw-job", raw.model_dump(exclude_none=True))
        log.info("jobspy %r → %d jobs", payload.query, len(jobs))
        return {"found": len(jobs)}

    worker = Worker(DISCOVER_QUEUE, process, {"connection": redis_url, "concurrency": 1})
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("scraper worker listening on %s", DISCOVER_QUEUE)
    await stop.wait()
    await worker.close()
    await normalize.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    asyncio.run(run())
