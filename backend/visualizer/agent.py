"""Sends a prompt to an AI engine on this computer (Claude Code or GitHub Copilot CLI) and streams what it prints.
Claude Code's own hooks (the plugin) report what it does, so the visualizers update as it works. Nothing here edits
files; the engine does, and only in the folder the user opened. The prompt goes in on standard input."""

from __future__ import annotations

import os
import subprocess
import threading
from dataclasses import dataclass
from typing import Callable, Optional

from . import engines
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
                on_output: Optional[Callable[[str, str, str], None]] = None, accept_edits: bool = True, engine: str = "claude") -> str:
    try:
        label = engines.spec(engine)["label"]
        exe = claude_path() if engine == "claude" else engines.find(engine)
        if not exe and engine == "claude":
            raise AgentProblem(problem(
                "Claude Code was not found", ["The `claude` command is not on this computer's PATH"],
                "Install Claude Code, then try again. The app still shows what it does when you use it from a terminal.",
            ))
        args = engines.agent_command(engine, model, accept_edits, exe=exe)
    except engines.EngineProblem as err:
        raise AgentProblem(err.problem) from None
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        proc = subprocess.Popen(
            args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", creationflags=flags, env=engines.child_env(),
        )
    except OSError as err:
        raise AgentProblem(problem(f"{label} could not be started", [str(err)], "Reinstall it, then try again.")) from None

    def feed() -> None:
        try:
            proc.stdin.write(prompt)
            proc.stdin.close()
        except (OSError, ValueError):
            pass  # it exited before reading; its own output says why

    threading.Thread(target=feed, daemon=True).start()
    run_id = new_id("agent")
    with _lock:
        _runs[run_id] = AgentRun(run_id, proc)

    said: dict = {"out": [], "err": []}  # the last lines it printed, to explain a failure

    def tell(line: str, name: str) -> None:
        said[name].append(line)
        del said[name][:-20]
        if on_output:
            on_output(line, name, run_id)

    def pump(stream, name: str) -> None:
        for line in iter(stream.readline, ""):
            clean = line.rstrip("\r\n")
            if clean:
                tell(clean, name)
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
        if (proc.returncode or 0) > 0:  # a negative code means the user pressed Stop
            # A failed run usually means the account: say what to do, not only what the tool printed.
            # Its error stream, when it has one: the other stream is the agent talking about the user's code.
            p = engines.explain(engine, model, proc.returncode, "\n".join(said["err"] or said["out"]))
            tell(f"{p['what']}. {p['next']}", "err")
        hub.push({"type": "turn.end", "source": "app", "message": f"{label} finished (exit {proc.returncode})"})

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
