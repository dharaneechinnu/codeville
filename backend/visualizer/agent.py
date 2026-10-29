"""Sends a prompt to Claude Code on this computer and streams what it prints. Claude Code's own hooks (the plugin)
report what it does, so the visualizers update as it works. Nothing here edits files; Claude Code does, and only
in the folder the user opened."""

from __future__ import annotations

import os
import subprocess
import threading
from dataclasses import dataclass
from typing import Callable, Optional

from .events import new_id, problem
from .exe import find_exe
from .hub import EventHub


class AgentProblem(Exception):
    def __init__(self, p: dict):
        super().__init__(p["what"])
        self.problem = p


@dataclass
class AgentRun:
    run_id: str
    proc: subprocess.Popen


_runs: dict = {}
_lock = threading.Lock()


def claude_path() -> Optional[str]:
    return find_exe("claude")


def send_prompt(prompt: str, cwd: str, hub: EventHub, model: Optional[str] = None,
                on_output: Optional[Callable[[str, str, str], None]] = None, accept_edits: bool = True) -> str:
    exe = claude_path()
    if not exe:
        raise AgentProblem(problem(
            "Claude Code was not found", ["The `claude` command is not on this computer's PATH"],
            "Install Claude Code, then try again. The app still shows what it does when you use it from a terminal.",
        ))
    args = [exe, "-p", prompt]
    if model:
        args += ["--model", model]
    if accept_edits:
        args += ["--permission-mode", "acceptEdits"]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    proc = subprocess.Popen(
        args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
        text=True, encoding="utf-8", errors="replace", creationflags=flags,
    )
    run_id = new_id("agent")
    with _lock:
        _runs[run_id] = AgentRun(run_id, proc)

    def pump(stream, name: str) -> None:
        for line in iter(stream.readline, ""):
            clean = line.rstrip("\r\n")
            if on_output and clean:
                on_output(clean, name, run_id)
        stream.close()

    def watch() -> None:
        threads = [threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True), threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True)]
        for t in threads:
            t.start()
        proc.wait()
        for t in threads:
            t.join(timeout=2)
        with _lock:
            _runs.pop(run_id, None)
        hub.push({"type": "turn.end", "source": "app", "message": f"Claude Code finished (exit {proc.returncode})"})

    threading.Thread(target=watch, daemon=True).start()
    return run_id


def stop(run_id: str) -> bool:
    with _lock:
        run = _runs.get(run_id)
    if not run:
        return False
    if run.proc.poll() is None:
        run.proc.kill()
    return True
