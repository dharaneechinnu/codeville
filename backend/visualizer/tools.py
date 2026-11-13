"""Tools for agents. Any agent can ask this app what the project looks like, what just happened and what is broken,
and can run the project's own checks and get a crisp answer back. They are served over HTTP (/api/tools) and,
through the plugin's MCP server, to Claude Code. Each tool has a name, a plain description and a JSON schema."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from . import state
from .analysis import agentmap, steps
from .analysis.commands import find_commands, find_tests
from .analysis.connections import find_connections
from .analyzer import analyze_project
from .events import crisp
from .git import NotARepo, git_status
from .hub import EventHub
from .parsers import classify_command
from .runner import run_command

CHECK_KINDS = ["test", "lint", "typecheck", "build"]


class ToolError(Exception):
    """A mistake the caller can fix. The message says what broke and what to do next."""


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    run: Callable[[dict, EventHub], dict]


def _project_root(args: dict) -> str:
    path = args.get("path") or state.get_root()
    if not path:
        raise ToolError("No project is open. Open a folder in the app, or pass `path`.")
    p = Path(path)
    if not p.is_dir():
        raise ToolError(f"That folder does not exist: {p}")
    return str(p.resolve())


def _default_command(kind: str, root: str) -> str:
    base = Path(root)
    pkg = base / "package.json"
    if pkg.exists():
        try:
            scripts = json.loads(pkg.read_text(encoding="utf8")).get("scripts", {})
        except (OSError, ValueError):
            scripts = {}
        names = {"test": ["test"], "lint": ["lint"], "typecheck": ["typecheck", "type-check", "tsc"], "build": ["build"]}[kind]
        for n in names:
            if n in scripts:
                return "npm test" if n == "test" else f"npm run {n}"
        if kind == "typecheck" and (base / "tsconfig.json").exists():
            return "npx tsc --noEmit"
    if any((base / f).exists() for f in ("pyproject.toml", "pytest.ini", "requirements.txt", "setup.py")):
        return {"test": "python -m pytest -q", "lint": "python -m ruff check .", "typecheck": "python -m mypy .", "build": "python -m build"}[kind]
    raise ToolError(f"I could not find a {kind} command for this project. Pass one in `command`.")


def _short(e: dict) -> dict:
    keep = {k: v for k, v in e.items() if k not in ("id",)}
    return keep


# ---- the tools -------------------------------------------------------------------------------------------------


def project_map(args: dict, hub: EventHub) -> dict:
    root = _project_root(args)
    a = analyze_project(root)
    state.set_root(root)
    wanted = (args.get("feature") or "").strip().lower()
    feats = a["features"]
    if wanted:
        feats = [f for f in feats if f["name"].lower() == wanted or f["id"] == wanted]
        if not feats:
            names = ", ".join(f["name"] for f in a["features"])
            raise ToolError(f'There is no feature called "{args["feature"]}". Try one of: {names}.')
    limit = int(args.get("max_files") or 40)
    return {
        "project": a["name"], "kind": a["kind"], "root": a["root"], "totalFiles": a["totalFiles"],
        "features": [
            {"name": f["name"], "path": f["path"], "fileCount": len(f["files"]), "files": [x["path"] for x in f["files"][:limit]]}
            for f in feats
        ],
    }


def analyze_project_tool(args: dict, hub: EventHub) -> dict:
    """Runs the whole analysis agent and returns its report without the file lists."""
    root = _project_root(args)
    a = analyze_project(root, hub.push)
    state.set_root(root)
    return {
        "title": a["title"], "summary": a["summary"], "kind": a["kind"], "stack": a["stack"], "layers": a["layers"],
        "totalFiles": a["totalFiles"], "steps": a["steps"],
        "features": [{"name": f["name"], "kind": f["kind"], "fileCount": len(f["files"]), "layers": f["layers"]} for f in a["features"]],
    }


def detect_stack_tool(args: dict, hub: EventHub) -> dict:
    root = Path(_project_root(args))
    files = steps.scan_files(root)["files"]
    return steps.detect_stack(root, files)


def project_map_request(args: dict, hub: EventHub) -> dict:
    """The instructions for describing the project, with the exact shape of the map and the file list."""
    root = Path(_project_root(args))
    files = steps.scan_files(root)["files"]
    steps.classify_layers(files, steps.detect_stack(root, files))
    return {"instructions": agentmap.map_prompt(files), "file": agentmap.MAP_FILE, "saveWith": "save_project_map"}


def save_project_map(args: dict, hub: EventHub) -> dict:
    """Saves the map an agent wrote after reading the code. The town is rebuilt from it."""
    root = Path(_project_root(args))
    files = steps.scan_files(root)["files"]
    steps.classify_layers(files, steps.detect_stack(root, files))
    try:
        out = agentmap.save_map(root, args.get("map"), files)
    except ValueError as err:
        raise ToolError(f"The map was not saved. {err} Call project_map_request for the exact shape and the file list.") from err
    hub.push({"type": "file.change", "source": "app", "path": agentmap.MAP_FILE, "op": "edit"})
    return out


def find_connections_tool(args: dict, hub: EventHub) -> dict:
    root = Path(_project_root(args))
    files = steps.scan_files(root)["files"]
    stack = steps.detect_stack(root, files)
    steps.classify_layers(files, stack)
    links = find_connections(root, steps.find_features(files))
    limit = int(args.get("max_links") or 60)
    return {"links": links[:limit], "total": len(links)}


def find_commands_tool(args: dict, hub: EventHub) -> dict:
    return {"commands": find_commands(Path(_project_root(args)))}


def find_tests_tool(args: dict, hub: EventHub) -> dict:
    root = Path(_project_root(args))
    files = steps.scan_files(root)["files"]
    stack = steps.detect_stack(root, files)
    steps.classify_layers(files, stack)
    tests = find_tests(root, files, find_commands(root))
    limit = int(args.get("max_tests") or 100)
    return {"total": len(tests), "tests": tests[:limit]}


def find_features_tool(args: dict, hub: EventHub) -> dict:
    root = Path(_project_root(args))
    files = steps.scan_files(root)["files"]
    stack = steps.detect_stack(root, files)
    steps.classify_layers(files, stack)
    limit = int(args.get("max_files") or 25)
    return {"features": [
        {"name": f["name"], "kind": f["kind"], "layers": f["layers"], "files": [x["path"] for x in f["files"][:limit]]}
        for f in steps.find_features(files)
    ]}


def recent_events(args: dict, hub: EventHub) -> dict:
    n = max(1, min(200, int(args.get("n") or 30)))
    types = set(args.get("types") or [])
    events = [e for e in hub.recent(1000) if not types or e["type"] in types]
    return {"events": [_short(e) for e in events[-n:]]}


def current_problems(args: dict, hub: EventHub) -> dict:
    """The newest result of each kind of check. A kind that last passed is not a problem."""
    problems: list = []
    seen: set = set()
    for e in reversed(hub.recent(1000)):
        if e["type"] != "run.end" or e["kind"] in seen:
            continue
        seen.add(e["kind"])
        if e["status"] == "fail":
            p = e.get("problem")
            problems.append({"kind": e["kind"], **(crisp(p) if p else {"title": f"{e['kind']} failed", "broke": "", "next": "Run it again and read the output.", "where": None})})
    return {"ok": not problems, "problems": problems}


def run_check(args: dict, hub: EventHub) -> dict:
    kind = args.get("kind")
    if kind not in CHECK_KINDS:
        raise ToolError(f"`kind` must be one of {', '.join(CHECK_KINDS)}.")
    root = _project_root(args)
    state.set_root(root)
    command = (args.get("command") or "").strip() or _default_command(kind, root)
    if classify_command(command) != kind:
        raise ToolError(f"That is not a {kind} command. Use the project's own {kind} command, or leave `command` empty.")
    timeout = max(5, min(600, int(args.get("timeout") or 180)))
    handle = run_command(command, root, hub, timeout=timeout, source="terminal")
    if not handle.wait(timeout + 15):
        handle.kill()
        raise ToolError(f"The {kind} run took longer than {timeout} seconds and was stopped. Try a smaller scope.")
    end = hub.find(lambda e: e["type"] == "run.end" and e.get("runId") == handle.run_id)
    if end is None:
        raise ToolError("The run finished but left no result. Try again.")
    steps = [
        {"name": e["name"], "file": e["problem"].get("file"), "line": e["problem"].get("line"), "broke": crisp(e["problem"])["broke"], "next": e["problem"]["next"]}
        for e in hub.recent(1000)
        if e["type"] == "step.fail" and e.get("runId") == handle.run_id
    ]
    return {
        "status": end["status"], "kind": kind, "command": command, "passed": end["passed"], "failed": end["failed"],
        "skipped": end["skipped"], "ms": end["ms"], "problem": crisp(end["problem"]) if end.get("problem") else None, "failedSteps": steps,
    }


def git_status_tool(args: dict, hub: EventHub) -> dict:
    root = _project_root(args)
    try:
        status = git_status(root)
    except NotARepo as err:
        raise ToolError(f"{err}. Run `git init` first.") from err
    hub.push({"type": "git.status", "source": "git", **status})
    return status


TOOLS: dict = {
    t.name: t
    for t in [
        Tool(
            "project_map",
            "Lists the project's features (like Cart, Login, Payment) and the files in each, so you know where to work.",
            {"type": "object", "properties": {
                "path": {"type": "string", "description": "Project folder. Defaults to the one open in the app."},
                "feature": {"type": "string", "description": "Only this feature, for example Cart."},
                "max_files": {"type": "integer", "description": "Files to list per feature. Default 40."}}},
            project_map,
        ),
        Tool(
            "analyze_project",
            "Runs the project analysis agent: what the project is, its frontend, backend, database and outside services, "
            "how many files sit in each layer, and its features. The same analysis the app runs when a project is imported.",
            {"type": "object", "properties": {"path": {"type": "string", "description": "Project folder. Defaults to the one open in the app."}}},
            analyze_project_tool,
        ),
        Tool(
            "detect_stack",
            "The frameworks, database and outside services the project uses (for example React, FastAPI, PostgreSQL, Stripe).",
            {"type": "object", "properties": {"path": {"type": "string"}}},
            detect_stack_tool,
        ),
        Tool(
            "find_connections",
            "How the parts of the project connect: which frontend calls which backend, what stores data in the database, "
            "which files use an outside service, and what imports what. Each link says from, to, kind and weight.",
            {"type": "object", "properties": {
                "path": {"type": "string"}, "max_links": {"type": "integer", "description": "Links to return, strongest first. Default 60."}}},
            find_connections_tool,
        ),
        Tool(
            "project_map_request",
            "How to describe this project for the town: the instructions, the exact JSON shape of the map, and the list of files. "
            "Read the code, then send the map with save_project_map.",
            {"type": "object", "properties": {"path": {"type": "string"}}},
            project_map_request,
        ),
        Tool(
            "save_project_map",
            "Saves your description of the project after you have read the code: the kind of app, the steps a user goes through in order, "
            "the files that do each step, each step's entry file, and one plain line per file. The town is rebuilt from it: each step becomes "
            "a house, the entry file its door.",
            {"type": "object", "required": ["map"], "properties": {
                "map": {"type": "object", "description": "The map, in the shape project_map_request describes."}, "path": {"type": "string"}}},
            save_project_map,
        ),
        Tool(
            "find_commands",
            "The project's own test, lint, type check and build commands, and the folder each one runs in (for example backend and frontend).",
            {"type": "object", "properties": {"path": {"type": "string"}}},
            find_commands_tool,
        ),
        Tool(
            "find_tests",
            "The test cases written in the project's test files: file, name and line, and the folder whose test command runs them.",
            {"type": "object", "properties": {
                "path": {"type": "string"}, "max_tests": {"type": "integer", "description": "Test cases to return. Default 100."}}},
            find_tests_tool,
        ),
        Tool(
            "find_features",
            "The project's features, each with how many frontend, backend and test files it has, and its files.",
            {"type": "object", "properties": {
                "path": {"type": "string"}, "max_files": {"type": "integer", "description": "Files to list per feature. Default 25."}}},
            find_features_tool,
        ),
        Tool(
            "recent_events",
            "The latest things that happened: files changed, tools used, sub-agents, test and build results.",
            {"type": "object", "properties": {
                "n": {"type": "integer", "description": "How many events, 1 to 200. Default 30."},
                "types": {"type": "array", "items": {"type": "string"}, "description": "Only these types, for example [\"file.change\", \"run.end\"]."}}},
            recent_events,
        ),
        Tool(
            "current_problems",
            "What is broken right now: the newest failing test, lint, type or build run, each as what broke, where, and what to do next.",
            {"type": "object", "properties": {}},
            current_problems,
        ),
        Tool(
            "run_check",
            "Runs the project's own test, lint, type check or build, waits for it, and returns what broke, where, and what to do next. "
            "The run also shows up live in the visualizer.",
            {"type": "object", "required": ["kind"], "properties": {
                "kind": {"type": "string", "enum": CHECK_KINDS},
                "command": {"type": "string", "description": "Optional. Defaults to the project's own command. It must match the kind."},
                "path": {"type": "string", "description": "Project folder. Defaults to the one open in the app."},
                "timeout": {"type": "integer", "description": "Seconds to wait, 5 to 600. Default 180."}}},
            run_check,
        ),
        Tool(
            "git_status",
            "The branch, how many files are staged or changed, and how far ahead or behind it is.",
            {"type": "object", "properties": {"path": {"type": "string"}}},
            git_status_tool,
        ),
    ]
}


def list_tools() -> list:
    return [{"name": t.name, "description": t.description, "inputSchema": t.input_schema} for t in TOOLS.values()]


def call_tool(name: str, args: Optional[dict], hub: EventHub) -> dict:
    tool = TOOLS.get(name)
    if tool is None:
        raise ToolError(f'There is no tool called "{name}". Available: {", ".join(TOOLS)}.')
    if args is not None and not isinstance(args, dict):
        raise ToolError("Send the arguments as a JSON object.")
    return tool.run(args or {}, hub)
