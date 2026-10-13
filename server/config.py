"""Configuration never travels to the browser, except explicit public health fields."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def _int(name: str, default: int, lower: int, upper: int) -> int:
    return max(lower, min(upper, int(os.getenv(name, str(default)))))


@dataclass(frozen=True)
class Settings:
    mode: str = "demo"
    nebius_api_key: str = ""
    nebius_base_url: str = "https://api.tokenfactory.us-central1.nebius.com/v1"
    nano_model: str = "nvidia/nvidia-nemotron-3-nano-30b-a3b"
    super_model: str = "nvidia/nemotron-3-super-120b-a12b"
    ultra_model: str = "nvidia/Nemotron-3-Ultra-550b-a55b"
    enable_ultra: bool = False
    tavily_api_key: str = ""
    enable_tavily: bool = False
    access_token: str = ""
    worker_token: str = ""
    allowed_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    database_path: str = "data/ripple.sqlite3"
    inline_jobs: bool = True
    max_requests_per_minute: int = 12
    max_live_repairs_per_day: int = 25
    max_concurrent_repairs: int = 2
    max_completion_tokens: int = 2000
    provider_timeout_seconds: int = 75
    job_retention_hours: int = 24

    @classmethod
    def from_env(cls) -> Settings:
        mode = os.getenv("RIPPLE_MODE", "demo")
        if mode not in {"demo", "live"}:
            raise ValueError("RIPPLE_MODE must be demo or live")
        url = os.getenv("NEBIUS_BASE_URL", cls.nebius_base_url).rstrip("/")
        if url not in {
            "https://api.tokenfactory.us-central1.nebius.com/v1",
            "https://api.tokenfactory.nebius.com/v1",
            "https://api.tokenfactory.eu-north1.nebius.com/v1",
        }:
            raise ValueError("NEBIUS_BASE_URL must be an official Token Factory API endpoint")
        origins = tuple(x.strip() for x in os.getenv("RIPPLE_ALLOWED_ORIGINS", ",".join(cls.allowed_origins)).split(",") if x.strip())
        if "*" in origins:
            raise ValueError("Use explicit RIPPLE_ALLOWED_ORIGINS, never '*'")
        return cls(
            mode=mode,
            nebius_api_key=os.getenv("NEBIUS_API_KEY", ""),
            nebius_base_url=url,
            nano_model=os.getenv("NEBIUS_NANO_MODEL", cls.nano_model),
            super_model=os.getenv("NEBIUS_SUPER_MODEL", cls.super_model),
            ultra_model=os.getenv("NEBIUS_ULTRA_MODEL", cls.ultra_model),
            enable_ultra=os.getenv("RIPPLE_ENABLE_ULTRA", "false").lower() == "true",
            tavily_api_key=os.getenv("TAVILY_API_KEY", ""),
            enable_tavily=os.getenv("RIPPLE_ENABLE_TAVILY", "false").lower() == "true",
            access_token=os.getenv("RIPPLE_ACCESS_TOKEN", ""),
            worker_token=os.getenv("RIPPLE_WORKER_TOKEN", ""),
            allowed_origins=origins,
            database_path=os.getenv("RIPPLE_DATABASE_PATH", cls.database_path),
            inline_jobs=os.getenv("RIPPLE_INLINE_JOBS", "true").lower() == "true",
            max_requests_per_minute=_int("RIPPLE_RATE_LIMIT", 12, 1, 120),
            max_live_repairs_per_day=_int("RIPPLE_DAILY_LIVE_LIMIT", 25, 1, 500),
            max_concurrent_repairs=_int("RIPPLE_CONCURRENCY", 2, 1, 8),
            max_completion_tokens=_int("RIPPLE_MAX_COMPLETION_TOKENS", 2000, 512, 4096),
            provider_timeout_seconds=_int("RIPPLE_PROVIDER_TIMEOUT", 75, 5, 120),
            job_retention_hours=_int("RIPPLE_JOB_RETENTION_HOURS", 24, 1, 168),
        )
