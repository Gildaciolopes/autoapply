"""Mirrors packages/shared/src/queues.ts (DiscoverPayload / RawJob). Keep both in sync."""

from typing import Literal

from pydantic import BaseModel, Field

WorkMode = Literal["remote", "hybrid", "onsite"]


class JobspyDiscoverPayload(BaseModel):
    query: str
    location: str = "Brasil"
    sites: list[str] = Field(default_factory=lambda: ["indeed", "glassdoor", "google"])
    limit: int = 50
    hours_old: int | None = 72


class RawJob(BaseModel):
    source: Literal["jobspy"] = "jobspy"
    externalId: str | None = None
    url: str
    applyUrl: str | None = None
    company: str
    title: str
    description: str | None = None
    location: str | None = None
    workMode: WorkMode | None = None
    salaryMin: float | None = None
    salaryMax: float | None = None
    postedAt: str | None = None
