from __future__ import annotations

import os
import subprocess

from .parsers import parse_git_status


class NotARepo(Exception):
    pass


def git_status(cwd: str) -> dict:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain=v1", "-b"], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=20, creationflags=flags,
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        raise NotARepo("Git did not answer") from err
    if out.returncode != 0:
        raise NotARepo("This folder is not a git repository")
    return parse_git_status(out.stdout)
