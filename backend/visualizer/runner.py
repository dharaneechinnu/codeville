"""Runs a command the way the terminal does, and turns what it prints into events.
Test output is read while it streams, so the visualizer can follow each test as it finishes."""

from __future__ import annotations

import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from .events import new_id
from .hub import EventHub
from .parsers import classify_command, parse_command_output, parse_test_output, relativize_run
from .run_events import run_finish, run_start, step_events


_handles: dict = {}


def stop_run(run_id: str) -> bool:
    h = _handles.get(run_id)
    if not h:
        return False
    h.kill()
    return True


@dataclass
class RunHandle:
    run_id: str
    done: threading.Event = field(default_factory=threading.Event)
    exit_code: Optional[int] = None
    _proc: Optional[subprocess.Popen] = None

    def kill(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.kill()

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self.done.wait(timeout)


def run_command(
    command: str,
    cwd: str,
    hub: EventHub,
    on_output: Optional[Callable[[str, str, str], None]] = None,
    timeout: float = 600,
    source: str = "terminal",
    root: Optional[str] = None,
) -> RunHandle:
    base = root or cwd  # paths in messages are shown relative to the project folder
    run_id = new_id("run")
    kind = classify_command(command)
    started = time.time()
    handle = RunHandle(run_id=run_id)
    _handles[run_id] = handle
    chunks: list = []
    lock = threading.Lock()
    sent = {"steps": 0}
    hub.push(run_start(run_id, kind, command, source))

    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        proc = subprocess.Popen(
            command, shell=True, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", creationflags=flags,
        )
    except OSError as err:
        parsed = relativize_run(parse_command_output(command, str(err), 127), base)
        hub.push_many(run_finish(run_id, command, parsed, 0, 0, source))
        handle.exit_code = 127
        handle.done.set()
        return handle
    handle._proc = proc

    def pump(stream, name: str) -> None:
        for line in iter(stream.readline, ""):
            clean = line.rstrip("\r\n")
            with lock:
                chunks.append(line)
            if on_output and clean != "":
                on_output(clean, name, run_id)
        stream.close()

    readers = [
        threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True),
        threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True),
    ]
    for t in readers:
        t.start()

    def watch() -> None:
        # While a test run is going, send every finished test except the last one, which may still be collecting detail.
        while proc.poll() is None:
            if time.time() - started > timeout:
                proc.kill()
                break
            if kind == "test":
                with lock:
                    text = "".join(chunks)
                parsed = relativize_run(parse_test_output(text), base)
                upto = max(sent["steps"], len(parsed.steps) - 1)
                if upto > sent["steps"]:
                    hub.push_many(step_events(run_id, parsed.steps, sent["steps"], upto, source))
                    sent["steps"] = upto
            time.sleep(0.25)
        code = proc.wait()
        for t in readers:
            t.join(timeout=2)
        with lock:
            text = "".join(chunks)
        parsed = relativize_run(parse_command_output(command, text, code), base)
        hub.push_many(run_finish(run_id, command, parsed, sent["steps"], int((time.time() - started) * 1000), source))
        handle.exit_code = code
        handle.done.set()
        _handles.pop(run_id, None)

    threading.Thread(target=watch, daemon=True).start()
    return handle
