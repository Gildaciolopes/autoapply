import math
from typing import Any

from jobspy import scrape_jobs

from .models import SITE_BY_SOURCE, JobspyDiscoverPayload, JobspySource, RawJob


def _clean(v: Any) -> Any:
    """pandas gives NaN for missing values."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v


def _monthly_brl(row: dict[str, Any]) -> tuple[float | None, float | None]:
    """Only BRL amounts with a known period become structured salary (monthly)."""
    if (row.get("currency") or "BRL") != "BRL":
        return None, None
    interval = (row.get("interval") or "").lower()
    div = {"monthly": 1, "yearly": 12}.get(interval)
    if div is None:
        return None, None
    lo, hi = row.get("min_amount"), row.get("max_amount")
    return (lo / div if lo else None), (hi / div if hi else None)


def row_to_raw_job(row: dict[str, Any], source: JobspySource) -> RawJob | None:
    row = {k: _clean(v) for k, v in row.items()}
    if not row.get("job_url") or not row.get("title") or not row.get("company"):
        return None
    lo, hi = _monthly_brl(row)
    return RawJob(
        source=source,
        externalId=str(row["id"]) if row.get("id") else None,
        url=row["job_url"],
        applyUrl=row.get("job_url_direct"),
        company=row["company"],
        title=row["title"],
        description=row.get("description"),
        location=row.get("location"),
        city=row.get("city"),
        uf=row.get("state"),
        workMode="remote" if row.get("is_remote") else None,
        salaryMin=lo,
        salaryMax=hi,
        postedAt=str(row["date_posted"]) if row.get("date_posted") else None,
    )


def search(p: JobspyDiscoverPayload) -> list[RawJob]:
    site = SITE_BY_SOURCE[p.source]
    df = scrape_jobs(
        site_name=[site],
        search_term=p.query,
        google_search_term=f"{p.query} vagas {p.location}" if site == "google" else None,
        location=p.location,
        results_wanted=p.limit,
        hours_old=p.hoursOld,
        country_indeed="brazil",
        description_format="markdown",
        verbose=0,
    )
    jobs = (row_to_raw_job(r, p.source) for r in df.to_dict(orient="records"))
    return [j for j in jobs if j][: p.limit]
