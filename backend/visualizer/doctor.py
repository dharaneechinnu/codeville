"""First-run checks: which tools the app can use on this computer. Each result says what it is and what to do."""

from __future__ import annotations

import os
import subprocess

from .exe import find_exe

_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

TOOLS = [
    ("git", "Git", "Needed for Source control, push and copying repositories.", "Install Git for Windows from git-scm.com, then restart the app.", True),
    ("claude", "Claude Code", "Needed to send prompts from the Chat.", "Install Claude Code, then restart the app.", False),
    ("copilot", "GitHub Copilot CLI", "An optional AI engine for the Chat and the editor, signed in with your GitHub account.", "Install it with `npm install -g @github/copilot` if you want to use it.", False),
    ("node", "Node.js", "Needed to run JavaScript tests and builds.", "Install Node.js LTS from nodejs.org if your projects use it.", False),
]


def _version(exe: str) -> str:
    try:
        r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10, creationflags=_FLAGS)
        return (r.stdout or r.stderr).strip().splitlines()[0] if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired, IndexError):
        return ""


def check() -> list[dict]:
    out = []
    for key, title, why, nxt, required in TOOLS:
        path = find_exe(key)
        out.append({
            "id": key, "title": title, "about": why, "required": required,
            "ok": bool(path), "version": _version(path) if path else "",
            "next": "" if path else nxt,
        })
    return out
