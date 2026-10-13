import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.config import Settings
from server.jobs import JobStore, QueueError
from server.models import RepairRequest

FIXTURE = Path(__file__).resolve().parents[2] / "examples" / "repair-request.json"


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=str(tmp_path / "queue.sqlite3"), inline_jobs=False)


@pytest.fixture
def payload():
    return json.loads(FIXTURE.read_text())


def test_health_never_exposes_keys_and_live_requires_app_token(settings):
    settings = replace(settings, mode="live", nebius_api_key="private-provider-key", tavily_api_key="private-search-key")
    with TestClient(create_app(settings)) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert "private-provider-key" not in response.text and "private-search-key" not in response.text
        assert response.json()["requiresAuth"]


def test_demo_repair_and_explicit_cors(settings, payload):
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/repair", json=payload)
        assert response.status_code == 200 and response.json()["options"]
        headers = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
        response = client.options("/api/repair", headers=headers)
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        headers["Origin"] = "https://untrusted.example"
        response = client.options("/api/repair", headers=headers)
        assert "access-control-allow-origin" not in response.headers


def test_live_credentials_and_organizer_token_checked_before_provider(settings, payload):
    settings = replace(settings, mode="live", access_token="organizer-only")
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/repair", json=payload).status_code == 401
        response = client.post("/api/repair", json=payload, headers={"Authorization": "Bearer organizer-only"})
        assert response.status_code == 503 and response.json()["error"]["code"] == "not_configured"


def test_strict_body_limit_and_validation(settings, payload):
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/repair", content=b"x" * 66000).status_code == 413
        payload["plan"]["sessions"][0]["duration"] = "20"
        assert client.post("/api/repair", json=payload).status_code == 422


def test_repair_rate_limit_does_not_limit_polling(settings, payload):
    settings = replace(settings, max_requests_per_minute=1)
    with TestClient(create_app(settings)) as client:
        created = client.post("/api/jobs", json=payload)
        assert created.status_code == 202
        assert client.post("/api/jobs", json=payload).status_code == 429
        for _ in range(3):
            assert client.get(created.json()["pollUrl"]).status_code == 200


def test_queue_survives_process_reopen_and_has_unique_leases(settings, payload):
    store = JobStore(settings.database_path)
    job_id = store.create(RepairRequest.model_validate(payload))
    reopened = JobStore(settings.database_path)
    assert reopened.get(job_id)["status"] == "queued"
    claim = reopened.claim()
    assert claim["id"] == job_id and len(job_id) >= 30
    assert reopened.claim() is None
    with pytest.raises(QueueError):
        reopened.finish(job_id, "bad-lease", error={"code": "test"})
    reopened.finish(job_id, claim["leaseToken"], error={"code": "test"})
    assert reopened.get(job_id)["status"] == "failed"


def test_daily_allowance_is_persistent_and_not_silent(settings):
    store = JobStore(settings.database_path)
    store.reserve_live(1)
    with pytest.raises(QueueError, match="allowance"):
        JobStore(settings.database_path).reserve_live(1)


def test_private_worker_cannot_use_browser_token_and_results_revalidated(settings, payload):
    settings = replace(settings, access_token="organizer", worker_token="private-worker")
    with TestClient(create_app(settings)) as client:
        user = {"Authorization": "Bearer organizer"}
        worker = {"Authorization": "Bearer private-worker"}
        created = client.post("/api/jobs", json=payload, headers=user).json()
        assert client.post("/api/worker/claim", headers=user).status_code == 401
        claim = client.post("/api/worker/claim", headers=worker).json()["job"]
        assert claim["id"] == created["id"]
        good = client.post("/api/repair", json=payload, headers=user).json()
        good["options"][0]["sessions"][0]["ownerId"] = "maya"
        response = client.post(f"/api/worker/{claim['id']}/complete", headers=worker, json={"leaseToken": claim["leaseToken"], "result": good})
        assert response.status_code == 422
        assert client.get(created["pollUrl"], headers=user).json()["status"] == "running"


def test_remote_worker_result_round_trip(settings, payload):
    settings = replace(settings, worker_token="private-worker")
    with TestClient(create_app(settings)) as client:
        created = client.post("/api/jobs", json=payload).json()
        worker = {"Authorization": "Bearer private-worker"}
        claim = client.post("/api/worker/claim", headers=worker).json()["job"]
        result = client.post("/api/repair", json=payload).json()
        completed = client.post(f"/api/worker/{claim['id']}/complete", headers=worker, json={"leaseToken": claim["leaseToken"], "result": result})
        assert completed.status_code == 200
        assert client.get(created["pollUrl"]).json()["result"]["options"]
        assert client.post("/api/worker/claim", headers=worker).json()["job"] is None


@pytest.mark.parametrize("field,value", [("targetId", "conversation"), ("minutes", 1), ("kind", "duration")])
def test_worker_cannot_weaken_or_replace_confirmed_change(settings, payload, field, value):
    settings = replace(settings, worker_token="private-worker")
    payload["confirmedChange"] = {"kind": "delay", "targetId": "showcase", "minutes": 20, "description": "Delay the selected showcase."}
    with TestClient(create_app(settings)) as client:
        created = client.post("/api/jobs", json=payload).json()
        worker = {"Authorization": "Bearer private-worker"}
        claim = client.post("/api/worker/claim", headers=worker).json()["job"]
        assert claim["request"]["confirmedChange"] == payload["confirmedChange"]
        result = client.post("/api/repair", json=payload).json()
        assert result["options"]
        for option in result["options"]:
            by_id = {s["id"]: s for s in option["sessions"]}
            assert by_id["showcase"]["start"] >= 900 and by_id["conversation"]["start"] == 690
        result["options"] = []  # Even a no-option response may not replace the confirmed incident.
        result["interpretation"][field] = value
        rejected = client.post(f"/api/worker/{claim['id']}/complete", headers=worker, json={"leaseToken": claim["leaseToken"], "result": result})
        assert rejected.status_code == 422 and "confirmed" in rejected.json()["detail"]
        assert client.get(created["pollUrl"]).json()["status"] == "running"


def test_confirmed_api_rejects_unknown_target_and_ongoing_repair_round_trips(settings, payload):
    settings = replace(settings, worker_token="private-worker")
    payload["plan"]["asOf"] = 810
    payload["confirmedChange"] = {"kind": "duration", "targetId": "missing", "minutes": 25, "description": "Extend the selected activity."}
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/repair", json=payload).status_code == 422
        payload["confirmedChange"]["targetId"] = "build"
        created = client.post("/api/jobs", json=payload).json()
        worker = {"Authorization": "Bearer private-worker"}
        claim = client.post("/api/worker/claim", headers=worker).json()["job"]
        result = client.post("/api/repair", json=payload).json()
        assert result["interpretation"] == payload["confirmedChange"] and result["options"]
        completed = client.post(f"/api/worker/{claim['id']}/complete", headers=worker, json={"leaseToken": claim["leaseToken"], "result": result})
        assert completed.status_code == 200
        assert client.get(created["pollUrl"]).json()["result"]["interpretation"] == payload["confirmedChange"]
