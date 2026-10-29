"""The event contract. Every part of the app (the Claude Code plugin, the terminal runner, the parsers,
the visualizers and any agent built on top) speaks only this. One event is one small JSON object with a `type`.

A Problem is: {"what": str, "why": [str], "file": str|None, "line": int|None, "next": str}.
It says what broke, why, and what to do next, so every message stays crisp.
"""

from __future__ import annotations

import itertools
import time
from typing import Any, Optional

SOURCES = frozenset({"agent", "terminal", "git", "app"})
RUN_KINDS = frozenset({"test", "lint", "typecheck", "build", "command"})
TYPES = frozenset(
    {
        "session.start", "session.end", "prompt", "turn.end", "agent.start", "agent.stop", "tool", "file.change",
        "run.start", "step.start", "step.pass", "step.fail", "run.end", "git.status", "git.commit", "git.push", "analysis.step",
    }
)

_counter = itertools.count(1)


def new_id(prefix: str = "e") -> str:
    n = next(_counter)
    return f"{prefix}{int(time.time() * 1000):x}{n:x}"


def stamp(event: dict) -> dict:
    """Adds an id and a time to an event that does not have them yet."""
    out = dict(event)
    out.setdefault("id", new_id())
    out.setdefault("ts", int(time.time() * 1000))
    return out


def parse_new_event(value: Any) -> Optional[dict]:
    """Checks the shape of something that came in over the wire. Does not trust it."""
    if not isinstance(value, dict):
        return None
    if value.get("type") not in TYPES or value.get("source") not in SOURCES:
        return None
    ts = value.get("ts")
    if ts is not None and (isinstance(ts, bool) or not isinstance(ts, (int, float))):
        return None
    if value.get("id") is not None and not isinstance(value["id"], str):
        return None
    return value


def problem(what: str, why: Optional[list] = None, nxt: str = "", file: Optional[str] = None, line: Optional[int] = None) -> dict:
    return {"what": what, "why": list(why or []), "file": file, "line": line, "next": nxt}


def crisp(p: dict) -> dict:
    """The two lines users read: what broke, and what is next."""
    where = None
    if p.get("file"):
        where = f"{p['file']}:{p['line']}" if p.get("line") else p["file"]
    why = p.get("why") or []
    return {"title": p["what"], "broke": (". ".join(why) + ".") if why else "", "next": p.get("next", ""), "where": where}
