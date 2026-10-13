"""Single-instance durable queue. Remote workers claim jobs through the private API."""
from __future__ import annotations

import json
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager

from .models import RepairRequest, RepairResult


class QueueError(Exception):
    pass


class JobStore:
    def __init__(self, path: str, retention_hours: int = 24):
        self.path, self.retention_seconds = path, retention_hours * 3600
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, state TEXT NOT NULL, created REAL NOT NULL,
                    updated REAL NOT NULL, request TEXT NOT NULL, result TEXT, error TEXT,
                    lease TEXT, lease_until REAL
                );
                CREATE TABLE IF NOT EXISTS daily_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def reserve_live(self, limit: int):
        day = datetime.now(timezone.utc).date().isoformat()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT count FROM daily_usage WHERE day = ?", (day,)).fetchone()
            if row and row[0] >= limit:
                raise QueueError("The daily live-repair allowance is used. Increase it server-side only after reviewing usage.")
            db.execute("INSERT INTO daily_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1", (day,))

    def create(self, request: RepairRequest) -> str:
        now, job_id = time.time(), secrets.token_urlsafe(24)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._expire(db, now)
            pending = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]
            if pending >= 20:
                raise QueueError("The background queue is full. Try again after an existing repair finishes.")
            db.execute("INSERT INTO jobs(id,state,created,updated,request) VALUES(?,'queued',?,?,?)", (job_id, now, now, request.model_dump_json()))
        return job_id

    def _expire(self, db, now):
        db.execute("DELETE FROM jobs WHERE created < ?", (now - self.retention_seconds,))
        db.execute("UPDATE jobs SET state='failed',error=?,updated=? WHERE state='running' AND lease_until < ?", (json.dumps({"code": "worker_interrupted", "message": "The worker's lease expired. No automatic paid retry was started; submit again if needed."}), now, now))

    def get(self, job_id: str) -> dict | None:
        with self.connect() as db:
            self._expire(db, time.time())
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            return None
        return {"id": row["id"], "status": row["state"], "createdAt": datetime.fromtimestamp(row["created"], timezone.utc).isoformat(), "result": json.loads(row["result"]) if row["result"] else None, "error": json.loads(row["error"]) if row["error"] else None}

    def claim(self, job_id: str | None = None, max_running: int | None = None) -> dict | None:
        now, lease = time.time(), secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._expire(db, now)
            if max_running is not None and db.execute("SELECT COUNT(*) FROM jobs WHERE state='running'").fetchone()[0] >= max_running:
                return None
            if job_id:
                row = db.execute("SELECT * FROM jobs WHERE state='queued' AND id=?", (job_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return None
            db.execute("UPDATE jobs SET state='running',updated=?,lease=?,lease_until=? WHERE id=?", (now, lease, now + 600, row["id"]))
        return {"id": row["id"], "leaseToken": lease, "request": json.loads(row["request"])}

    def original_request(self, job_id: str) -> RepairRequest | None:
        with self.connect() as db:
            row = db.execute("SELECT request FROM jobs WHERE id=?", (job_id,)).fetchone()
        return RepairRequest.model_validate_json(row[0]) if row else None

    def finish(self, job_id: str, lease: str, result: RepairResult | None = None, error: dict | None = None):
        with self.connect() as db:
            cursor = db.execute("UPDATE jobs SET state=?,result=?,error=?,updated=?,lease=NULL WHERE id=? AND state='running' AND lease=? AND lease_until>=?", ("completed" if result else "failed", result.model_dump_json(exclude_none=True) if result else None, json.dumps(error) if error else None, time.time(), job_id, lease, time.time()))
            if cursor.rowcount != 1:
                raise QueueError("The job lease is missing, expired, or already completed.")
