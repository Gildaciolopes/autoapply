import math

import pandas as pd

from autoapply_scraper import jobspy_source
from autoapply_scraper.jobspy_source import row_to_raw_job
from autoapply_scraper.models import DiscoverResult, JobspyDiscoverPayload


def test_maps_row_and_drops_nan():
    job = row_to_raw_job(
        {
            "id": "in-123", "job_url": "https://br.indeed.com/viewjob?jk=1", "title": "Dev Full-Stack",
            "company": "Acme", "location": "São Paulo, SP", "city": "São Paulo", "state": "SP", "is_remote": True,
            "min_amount": math.nan, "max_amount": None, "date_posted": "2026-10-13",
        },
        "indeed",
    )
    assert job is not None
    assert job.source == "indeed"
    assert job.workMode == "remote"
    assert job.salaryMin is None
    assert job.externalId == "in-123"
    assert job.uf == "SP"


def test_salary_only_brl_with_known_period():
    base = {"job_url": "https://x/1", "title": "Dev", "company": "Acme"}
    yearly = row_to_raw_job({**base, "currency": "BRL", "interval": "yearly", "min_amount": 120000.0, "max_amount": 180000.0}, "glassdoor")
    assert (yearly.salaryMin, yearly.salaryMax) == (10000.0, 15000.0)
    usd = row_to_raw_job({**base, "currency": "USD", "interval": "monthly", "min_amount": 5000.0}, "glassdoor")
    assert usd.salaryMin is None
    hourly = row_to_raw_job({**base, "currency": "BRL", "interval": "hourly", "min_amount": 80.0}, "indeed")
    assert hourly.salaryMin is None


def test_skips_incomplete_rows():
    assert row_to_raw_job({"job_url": None, "title": "x", "company": "y"}, "indeed") is None


def test_search_maps_source_to_site_and_returns_contract(monkeypatch):
    calls = {}

    def fake_scrape(**kw):
        calls.update(kw)
        return pd.DataFrame([
            {"id": "g1", "job_url": "https://g/1", "title": "Dev Node", "company": "Acme"},
            {"id": "g2", "job_url": None, "title": "x", "company": "y"},
        ])

    monkeypatch.setattr(jobspy_source, "scrape_jobs", fake_scrape)
    p = JobspyDiscoverPayload(runId="r1", source="google_jobs", query="Desenvolvedor Node", limit=5)
    jobs = jobspy_source.search(p)
    assert calls["site_name"] == ["google"]
    assert calls["google_search_term"] == "Desenvolvedor Node vagas Brasil"
    assert calls["country_indeed"] == "brazil"
    assert calls["results_wanted"] == 5
    out = DiscoverResult(source=p.source, jobs=jobs).model_dump(exclude_none=True)
    assert out["source"] == "google_jobs"
    assert [j["externalId"] for j in out["jobs"]] == ["g1"]
    assert out["jobs"][0]["source"] == "google_jobs"
