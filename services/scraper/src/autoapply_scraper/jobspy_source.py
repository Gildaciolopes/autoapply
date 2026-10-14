import math
from typing import Any

from jobspy import scrape_jobs

from .models import JobspyDiscoverPayload, RawJob


def _clean(v: Any) -> Any:
    """pandas gives NaN for missing values."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v


def row_to_raw_job(row: dict[str, Any]) -> RawJob | None:
    row = {k: _clean(v) for k, v in row.items()}
    if not row.get("job_url") or not row.get("title") or not row.get("company"):
        return None
    return RawJob(
        externalId=str(row["id"]) if row.get("id") else None,
        url=row["job_url"],
        applyUrl=row.get("job_url_direct"),
        company=row["company"],
        title=row["title"],
        description=row.get("description"),
        location=row.get("location"),
        workMode="remote" if row.get("is_remote") else None,
        salaryMin=row.get("min_amount"),
        salaryMax=row.get("max_amount"),
        postedAt=str(row["date_posted"]) if row.get("date_posted") else None,
    )


def search(p: JobspyDiscoverPayload) -> list[RawJob]:
    df = scrape_jobs(
        site_name=p.sites,
        search_term=p.query,
        location=p.location,
        results_wanted=p.limit,
        hours_old=p.hours_old,
        country_indeed="brazil",
        description_format="markdown",
        verbose=0,
    )
    jobs = (row_to_raw_job(r) for r in df.to_dict(orient="records"))
    return [j for j in jobs if j]
