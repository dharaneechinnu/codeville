"""Runs the user's own coding agent on this computer. Claude Code runs as a real conversation; the other AI engines
(Copilot, Codex, Gemini, ... see engines.py) answer one prompt at a time and their output is shown as they print it.

Each prompt starts `claude -p` in its native streaming mode and reads what it prints as it goes: the words as they are
written, each tool it uses, and how the turn ended. A project keeps its session, so the next prompt continues the same
conversation (`--resume`) instead of starting over. Claude Code is given the Codeville tools (the plugin's MCP server),
so it can ask this app about the project and save a project map.

Nothing here edits files; Claude Code does, and only in the folder the user opened. When the Codeville plugin is
installed, its hooks report what Claude Code does; when it is not, the stream is turned into the same events here, so
the chat and the town work either way."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from . import engines
from .claude_hooks import FILE_TOOLS
from .config import config_dir
from .events import new_id, problem
from .exe import find_exe
from .hub import EventHub
from .parsers import normalize_path

MCP_NAME = "codeville"
# Claude Code may call the Codeville tools without asking: they only read the project and save the project map.
ALLOWED_TOOLS = [f"mcp__{MCP_NAME}", f"mcp__plugin_code-visualizer_{MCP_NAME}"]
NOT_SIGNED_IN = re.compile(r"(invalid api key|please run /login|not logged in|authentication_error|oauth token has expired)", re.I)
NO_SESSION = re.compile(r"no conversation found", re.I)
SIGN_IN_HELP = "Claude Code is not signed in. Open a terminal, run `claude`, sign in, then send your message again."


class AgentProblem(Exception):
    def __init__(self, p: dict):
        super().__init__(p["what"])
        self.problem = p


@dataclass
class AgentRun:
    run_id: str
    proc: subprocess.Popen


_runs: dict = {}
_sessions: dict = {}  # project folder -> the Claude Code session to continue
_lock = threading.Lock()
_plugin: dict = {"at": 0.0, "installed": False}


def claude_path() -> Optional[str]:
    return find_exe("claude")


def _key(cwd: str) -> str:
    return os.path.normcase(os.path.abspath(cwd))


def session_for(cwd: str) -> Optional[str]:
    with _lock:
        return _sessions.get(_key(cwd))


def forget_session(cwd: str) -> None:
    with _lock:
        _sessions.pop(_key(cwd), None)


def forget_plugin_state() -> None:
    """Call after the plugin is installed or removed, so the next prompt checks again."""
    _plugin["at"] = 0.0


def plugin_installed() -> bool:
    """Whether the plugin's hooks will report this session. Asked at most once every few minutes: it starts `claude`."""
    if time.time() - _plugin["at"] > 300:
        from . import connector

        _plugin["installed"] = bool(connector.status().get("installed"))
        _plugin["at"] = time.time()
    return _plugin["installed"]


def mcp_config() -> Optional[str]:
    """A file that tells Claude Code how to start the Codeville tool server. Used when the plugin is not installed."""
    script = Path(__file__).resolve().parents[2] / "plugin" / "code-visualizer" / "scripts" / "mcp.mjs"
    if not script.is_file():
        return None
    target = Path(config_dir()) / "mcp.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"mcpServers": {MCP_NAME: {"command": "node", "args": [str(script)]}}}), encoding="utf8")
    return str(target)


def build_args(exe: str, model: Optional[str], accept_edits: bool, resume: Optional[str], hooked: bool) -> list:
    """The prompt itself goes in on standard input, so long prompts with new lines survive every shell."""
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    if resume:
        args += ["--resume", resume]
    if model:
        args += ["--model", model]
    if accept_edits:
        args += ["--permission-mode", "acceptEdits"]
    if not hooked:
        cfg = mcp_config()
        if cfg:
            args += ["--mcp-config", cfg]
    args += ["--allowedTools", ",".join(ALLOWED_TOOLS)]
    return args


def _target(inp: dict) -> str:
    for k in ("file_path", "notebook_path", "command", "pattern", "url", "path", "description"):
        v = inp.get(k)
        if isinstance(v, str) and v:
            return v.splitlines()[0][:120]
    return ""


class Turn:
    """Reads one turn of Claude Code's stream and turns it into what the app shows: lines for the chat and events."""

    def __init__(self, prompt: str, cwd: str, hub: EventHub, emit: Callable[[str, str], None], hooked: bool, resumed: bool):
        self.prompt, self.cwd, self.hub, self.emit, self.hooked, self.resumed = prompt, cwd, hub, emit, hooked, resumed
        self.session: Optional[str] = None
        self.buf = ""
        self.done = False
        self.failed = ""

    def _push(self, event: dict) -> None:
        self.hub.push({**event, **({"sessionId": self.session} if self.session else {})})

    def _flush(self, everything: bool = False) -> None:
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            self.emit(line, "out")
        if everything and self.buf:
            self.emit(self.buf, "out")
            self.buf = ""

    def line(self, raw: str, stream: str = "out") -> None:
        raw = raw.strip()
        if not raw:
            return
        try:
            d = json.loads(raw) if raw.startswith("{") else None
        except ValueError:
            d = None
        if not isinstance(d, dict):
            # Not part of the stream: an error the command printed. Say it in plain words when we know it.
            if NOT_SIGNED_IN.search(raw):
                self.failed = SIGN_IN_HELP
            elif NO_SESSION.search(raw):
                self.failed = "That conversation could not be continued. Send your message again to start a new one."
                forget_session(self.cwd)
            self.emit(raw, stream)
            return
        kind = d.get("type")
        if kind == "system" and d.get("subtype") == "init":
            self.session = d.get("session_id") or self.session
            if self.session:
                with _lock:
                    _sessions[_key(self.cwd)] = self.session
            if not self.hooked:
                if not self.resumed:
                    self._push({"type": "session.start", "source": "agent", "cwd": self.cwd, "agent": "Claude Code", "model": d.get("model")})
                self._push({"type": "prompt", "source": "agent", "text": self.prompt[:2000]})
        elif kind == "stream_event":
            ev = d.get("event") or {}
            delta = ev.get("delta") or {}
            if ev.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                self.buf += delta.get("text") or ""
                self._flush()
            elif ev.get("type") == "content_block_stop":
                self._flush(True)
        elif kind == "assistant":
            for block in (d.get("message") or {}).get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                name = str(block.get("name") or "tool")
                inp = block.get("input") if isinstance(block.get("input"), dict) else {}
                target = _target(inp)
                self._flush(True)
                self.emit(f"→ {name.replace('mcp__', '').replace('__', ': ')} {target}".rstrip(), "out")
                if self.hooked:
                    continue  # the plugin's hooks report tools and file changes
                self._push({"type": "tool", "source": "agent", "tool": name, "phase": "start", "target": target or None})
                file = inp.get("file_path") or inp.get("notebook_path")
                if name in FILE_TOOLS and isinstance(file, str) and file:
                    self._push({"type": "file.change", "source": "agent", "path": normalize_path(file, self.cwd), "op": FILE_TOOLS[name]})
        elif kind == "result":
            self._flush(True)
            text = str(d.get("result") or "")
            if d.get("is_error") and NOT_SIGNED_IN.search(text):
                text = SIGN_IN_HELP
            self.finish(text, bool(d.get("is_error")))

    def finish(self, text: str, failed: bool = False) -> None:
        if self.done:
            return
        self.done = True
        if failed and text:
            self.emit(text, "err")
        # With the plugin, its Stop hook already reports Claude's last words; this event only says the turn is over.
        message = None if (self.hooked and not failed) else (text[:4000] or None)
        self._push({"type": "turn.end", "source": "app", "message": message})


def send_prompt(prompt: str, cwd: str, hub: EventHub, model: Optional[str] = None,
                on_output: Optional[Callable[[str, str, str], None]] = None, accept_edits: bool = True,
                session_id: Optional[str] = None, fresh: bool = False, engine: str = "claude") -> str:
    """Sends one prompt. With Claude Code it continues the project's conversation unless `fresh` asks for a new one or
    `session_id` names another one to continue. Any other engine gets the prompt on its own."""
    if engine != "claude":
        return _send_plain(engine, prompt, cwd, hub, model, on_output, accept_edits)
    exe = claude_path()
    if not exe:
        raise AgentProblem(problem(
            "Claude Code was not found", ["The `claude` command is not on this computer's PATH"],
            "Install Claude Code, then try again. The app still shows what it does when you use it from a terminal.",
        ))
    if fresh:
        forget_session(cwd)
    resume = None if fresh else (session_id or session_for(cwd))
    hooked = plugin_installed()
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    proc = subprocess.Popen(
        build_args(exe, model, accept_edits, resume, hooked), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        stdin=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", creationflags=flags,
    )
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
    except OSError:
        pass
    run_id = new_id("agent")
    with _lock:
        _runs[run_id] = AgentRun(run_id, proc)
    turn = Turn(prompt, cwd, hub, lambda line, stream: on_output(line, stream, run_id) if on_output else None, hooked, bool(resume))
    turn.session = resume

    def pump(stream, name: str) -> None:
        for line in iter(stream.readline, ""):
            turn.line(line, name)
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
        # A turn that never reported its own end: it was stopped, or the command failed before it could start.
        turn.finish(turn.failed or ("Stopped." if proc.returncode else ""), failed=bool(turn.failed))

    threading.Thread(target=watch, daemon=True).start()
    return run_id


def _send_plain(engine: str, prompt: str, cwd: str, hub: EventHub, model: Optional[str],
                on_output: Optional[Callable[[str, str, str], None]], accept_edits: bool) -> str:
    """An engine without Claude Code's stream: the prompt goes in on standard input and its lines are shown as they come."""
    try:
        label = engines.spec(engine)["label"]
        args = engines.agent_command(engine, model, accept_edits)
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
    hub.push({"type": "prompt", "source": "app", "text": prompt[:2000]})
    said: dict = {"out": [], "err": []}  # the last lines it printed, to explain a failure
    answer: list = []  # what it wrote on standard output: that is its reply

    def tell(line: str, name: str) -> None:
        said[name].append(line)
        del said[name][:-20]
        if name == "out":
            answer.append(line)
            del answer[:-400]
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
            failed = f"{p['what']}. {p['next']}"
            tell(failed, "err")
            answer.append(failed)
        # Like Claude Code's last words, the reply becomes a message in the conversation.
        text = "\n".join(answer)[-4000:] or ("Stopped." if proc.returncode else f"{label} finished and printed nothing.")
        hub.push({"type": "turn.end", "source": "app", "message": text})

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
