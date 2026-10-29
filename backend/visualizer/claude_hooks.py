"""Turns one Claude Code hook call into events of the shared contract."""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

from .parsers import classify_command, normalize_path, parse_command_output, relativize_run
from .run_events import run_finish, run_start

FILE_TOOLS = {"Edit": "edit", "MultiEdit": "edit", "NotebookEdit": "edit", "Write": "write"}
_start_times: dict = {}
_lock = threading.Lock()


def _s(v: Any) -> Optional[str]:
    return v if isinstance(v, str) and v else None


def read_tool_result(response: Any) -> dict:
    """Claude Code reports a tool's result in different shapes; this collects the text and the exit code."""
    if isinstance(response, str):
        return {"text": response, "exit_code": None}
    if not isinstance(response, dict):
        return {"text": "", "exit_code": None}
    parts = [response.get(k) for k in ("stdout", "stderr", "output", "content", "text") if isinstance(response.get(k), str)]
    code = next((response[k] for k in ("exit_code", "exitCode", "returncode", "returnCode", "code") if isinstance(response.get(k), int) and not isinstance(response.get(k), bool)), None)
    return {"text": "\n".join(parts), "exit_code": code}


def _target(p: dict) -> Optional[str]:
    inp = p.get("tool_input") or {}
    file = _s(inp.get("file_path")) or _s(inp.get("notebook_path")) or _s(inp.get("path"))
    if file:
        return normalize_path(file, p.get("cwd"))
    cmd = _s(inp.get("command"))
    if cmd:
        return cmd if len(cmd) <= 120 else cmd[:117] + "..."
    return _s(inp.get("pattern")) or _s(inp.get("url"))


def from_claude_hook(p: dict) -> list:
    sid = p.get("session_id")
    base = {"source": "agent"}
    if sid:
        base["sessionId"] = sid
    name = p.get("hook_event_name")
    tool = p.get("tool_name")

    if name == "SessionStart":
        return [{**base, "type": "session.start", "cwd": p.get("cwd") or "", "agent": "Claude Code", "model": p.get("model")}]
    if name == "SessionEnd":
        return [{**base, "type": "session.end"}]
    if name == "UserPromptSubmit":
        return [{**base, "type": "prompt", "text": p["prompt"][:2000]}] if p.get("prompt") else []
    if name == "Stop":
        return [{**base, "type": "turn.end", "message": (p.get("last_assistant_message") or "")[:400] or None}]
    if name == "SubagentStart":
        return [{**base, "type": "agent.start", "agentId": p.get("agent_id") or "subagent", "agentType": p.get("agent_type")}]
    if name == "SubagentStop":
        return [{**base, "type": "agent.stop", "agentId": p.get("agent_id") or "subagent", "agentType": p.get("agent_type")}]

    if name == "PreToolUse" and tool:
        out = [{**base, "type": "tool", "tool": tool, "phase": "start", "target": _target(p), "agentId": p.get("agent_id")}]
        command = _s((p.get("tool_input") or {}).get("command"))
        if tool == "Bash" and command and classify_command(command) != "command":
            run_id = f"run-{p.get('tool_use_id') or command}"
            with _lock:
                _start_times[run_id] = time.time()
            out.append({**run_start(run_id, classify_command(command), command, "agent"), **({"sessionId": sid} if sid else {})})
        return out

    if name in ("PostToolUse", "PostToolUseFailure") and tool:
        failed = name == "PostToolUseFailure"
        out = [{**base, "type": "tool", "tool": tool, "phase": "fail" if failed else "end", "target": _target(p), "agentId": p.get("agent_id")}]
        inp = p.get("tool_input") or {}
        op = FILE_TOOLS.get(tool)
        file = _s(inp.get("file_path")) or _s(inp.get("notebook_path"))
        if op and file and not failed:
            out.append({**base, "type": "file.change", "path": normalize_path(file, p.get("cwd")), "op": op, "agentId": p.get("agent_id")})
        command = _s(inp.get("command"))
        if tool == "Bash" and command and classify_command(command) != "command":
            run_id = f"run-{p.get('tool_use_id') or command}"
            with _lock:
                began = _start_times.pop(run_id, None)
            ms = int((time.time() - began) * 1000) if began else 0
            result = read_tool_result(p.get("tool_response"))
            text = "\n".join([result["text"], p.get("error") or ""]) if failed else result["text"]
            exit_code = (result["exit_code"] if result["exit_code"] is not None else 1) if failed else result["exit_code"]
            parsed = relativize_run(parse_command_output(command, text, exit_code), p.get("cwd"))
            for e in run_finish(run_id, command, parsed, 0, ms, "agent"):
                out.append({**e, **({"sessionId": sid} if sid else {})})
        return out
    return []
