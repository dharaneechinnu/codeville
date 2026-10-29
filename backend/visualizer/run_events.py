"""Turns a parsed run into events: a start, a pass or fail per step, and a summary."""

from __future__ import annotations

from typing import Optional

from .events import problem as make_problem
from .parsers.common import ParsedRun


def run_start(run_id: str, kind: str, command: str, source: str) -> dict:
    return {"type": "run.start", "runId": run_id, "kind": kind, "command": command, "source": source}


def step_events(run_id: str, steps: list, start: int, end: int, source: str) -> list:
    out: list = []
    for i in range(start, end):
        if i >= len(steps):
            break
        s = steps[i]
        step_id = f"{run_id}-{i}"
        out.append({"type": "step.start", "runId": run_id, "stepId": step_id, "name": s.name, "path": s.path, "source": source})
        if s.ok:
            out.append({"type": "step.pass", "runId": run_id, "stepId": step_id, "name": s.name, "path": s.path, "ms": s.ms, "source": source})
        else:
            out.append(
                {
                    "type": "step.fail", "runId": run_id, "stepId": step_id, "name": s.name, "path": s.path, "ms": s.ms, "source": source,
                    "problem": s.problem or make_problem(f"{s.name} failed", [], "Fix it, then run the test again."),
                }
            )
    return out


def run_finish(run_id: str, command: str, parsed: ParsedRun, sent_steps: int, ms: int, source: str) -> list:
    """Everything that follows a finished run: any steps not yet sent, then the summary."""
    out = step_events(run_id, parsed.steps, sent_steps, len(parsed.steps), source)
    # A lint, type or build run has no steps, so a failure becomes one step the visualizer can show.
    if not parsed.steps and parsed.problem:
        name = {"lint": "Lint", "typecheck": "Type check", "build": "Build"}.get(parsed.kind, "Command")
        path: Optional[str] = parsed.problem.get("file")
        out.append({"type": "step.start", "runId": run_id, "stepId": f"{run_id}-0", "name": name, "path": path, "source": source})
        out.append({"type": "step.fail", "runId": run_id, "stepId": f"{run_id}-0", "name": name, "path": path, "ms": ms, "problem": parsed.problem, "source": source})
    failed = parsed.failed > 0 or bool(parsed.problem)
    end = {
        "type": "run.end", "runId": run_id, "kind": parsed.kind, "status": "fail" if failed else "pass",
        "passed": parsed.passed, "failed": parsed.failed, "skipped": parsed.skipped, "ms": ms, "source": source,
    }
    if failed and parsed.problem:
        end["problem"] = parsed.problem
    out.append(end)
    return out
