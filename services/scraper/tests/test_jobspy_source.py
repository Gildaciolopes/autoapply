import math

from autoapply_scraper.jobspy_source import row_to_raw_job


def test_maps_row_and_drops_nan():
    job = row_to_raw_job({
        "id": "in-123", "job_url": "https://br.indeed.com/viewjob?jk=1", "title": "Dev Full-Stack",
        "company": "Acme", "location": "São Paulo, SP", "is_remote": True,
        "min_amount": math.nan, "max_amount": None, "date_posted": "2026-10-13",
    })
    assert job is not None
    assert job.workMode == "remote"
    assert job.salaryMin is None
    assert job.externalId == "in-123"


def test_skips_incomplete_rows():
    assert row_to_raw_job({"job_url": None, "title": "x", "company": "y"}) is None
