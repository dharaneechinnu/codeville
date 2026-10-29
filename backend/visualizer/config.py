"""The port and token, kept in one small file that the Claude Code plugin also reads."""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path

DEFAULT_PORT = 4317


def config_dir() -> str:
    return os.environ.get("CV_HOME") or str(Path.home() / ".code-visualizer")


def config_path() -> Path:
    return Path(config_dir()) / "config.json"


def load_config() -> dict:
    """Reads the config, or creates one with a fresh random token."""
    file = config_path()
    if file.exists():
        try:
            raw = json.loads(file.read_text(encoding="utf8"))
            if isinstance(raw.get("port"), int) and isinstance(raw.get("token"), str) and len(raw["token"]) >= 16:
                return {"port": raw["port"], "token": raw["token"]}
        except (OSError, ValueError):
            pass
    cfg = {"port": DEFAULT_PORT, "token": secrets.token_hex(24)}
    save_config(cfg)
    return cfg


def save_config(cfg: dict) -> None:
    Path(config_dir()).mkdir(parents=True, exist_ok=True)
    config_path().write_text(json.dumps(cfg, indent=2), encoding="utf8")
