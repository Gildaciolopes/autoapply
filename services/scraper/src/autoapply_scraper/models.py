"""Mirrors packages/shared/src/queues.ts (DiscoverPayload / RawJob / DiscoverResult). Keep both in sync."""

from typing import Literal

from pydantic import BaseModel

WorkMode = Literal["remote", "hybrid", "onsite"]
JobspySource = Literal["indeed", "glassdoor", "google_jobs"]

# DiscoverPayload.source → JobSpy site name
SITE_BY_SOURCE: dict[str, str] = {"indeed": "indeed", "glassdoor": "glassdoor", "google_jobs": "google"}


class JobspyDiscoverPayload(BaseModel):
    """Child job of a discovery flow (queue `discover-jobspy`)."""

    runId: str
    source: JobspySource
    query: str
    location: str = "Brasil"
    limit: int = 50
    hoursOld: int | None = 72


class RawJob(BaseModel):
    source: JobspySource
    externalId: str | None = None
    url: str
    applyUrl: str | None = None
    company: str
    title: str
    description: str | None = None
    location: str | None = None
    city: str | None = None
    uf: str | None = None
    workMode: WorkMode | None = None
    salaryMin: float | None = None
    salaryMax: float | None = None
    salaryText: str | None = None
    postedAt: str | None = None


class DiscoverResult(BaseModel):
    """Return value of the child job; read by the `process-run` flow parent."""

    source: JobspySource
    jobs: list[RawJob]
    error: str | None = None
