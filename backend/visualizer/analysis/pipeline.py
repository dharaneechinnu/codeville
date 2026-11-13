"""The project analysis agent. When a project is imported it runs its tools in order, tells the app about each step
as it goes ("analysis.step" events), and returns one report: what the project is, its stack, its layers and its features."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, Optional

from . import steps
from .commands import find_commands, find_tests
from .connections import trace
from .templates import match_template
from .agentmap import features_from_map, flow_from_map, load_map

Emit = Optional[Callable[[dict], None]]

STEP_LABELS = [
    ("scan_files", "Reading the folder"),
    ("read_identity", "Reading the README and package files"),
    ("detect_stack", "Detecting frameworks, database and services"),
    ("classify_layers", "Sorting files into frontend, backend, database and tests"),
    ("find_features", "Finding features"),
    ("match_template", "Matching a known kind of app and its user flow"),
    ("find_connections", "Tracing how the pieces connect"),
    ("find_commands", "Finding how to run tests, lint and build"),
    ("find_tests", "Listing the test cases"),
    ("summarize", "Putting it together"),
]


def run_analysis(root_input: str, emit: Emit = None) -> dict:
    root = Path(root_input).resolve()
    log: list = []

    def step(name: str, fn, detail) -> object:
        label = dict(STEP_LABELS)[name]
        if emit:
            emit({"type": "analysis.step", "source": "app", "step": name, "label": label, "status": "running"})
        t0 = time.time()
        result = fn()
        note = detail(result)
        ms = round((time.time() - t0) * 1000)
        log.append({"step": name, "label": label, "detail": note, "ms": ms})
        if emit:
            emit({"type": "analysis.step", "source": "app", "step": name, "label": label, "status": "done", "detail": note})
        return result

    scanned = step("scan_files", lambda: steps.scan_files(root), lambda r: f"{len(r['files'])} source files")
    files = scanned["files"]
    ident = step("read_identity", lambda: steps.read_identity(root), lambda r: r["title"])
    stack = step("detect_stack", lambda: steps.detect_stack(root, files), lambda r: ", ".join([*r["frontend"], *r["backend"], *r["database"]][:6]) or "nothing recognised")
    layers = step("classify_layers", lambda: steps.classify_layers(files, stack), lambda r: f"{r['frontend']} frontend, {r['backend']} backend, {r['database']} database, {r['tests']} tests")
    # When the connected agent has read the code and written its map, the town follows that; otherwise the names decide.
    amap = load_map(root, files)
    features = step("find_features", lambda: features_from_map(files, amap) if amap else steps.find_features(files), lambda r: f"{sum(1 for f in r if f['kind'] == 'feature')} features" + (", from the agent's map" if amap else ""))
    flow = step("match_template", lambda: flow_from_map(amap, files) if amap else {**match_template(features), "source": "names", "style": None}, lambda r: f"{r['template']['name']}: {r['found']} of {r['total']} steps found")
    connections, file_links = step("find_connections", lambda: trace(root, features), lambda r: f"{len(r[0])} links between buildings, {len(r[1])} between files")
    commands = step("find_commands", lambda: find_commands(root), lambda r: f"{sum(1 for c in r if c['kind'] == 'test')} test commands, {len(r)} in all")
    tests = step("find_tests", lambda: find_tests(root, files, commands), lambda r: f"{len(r)} test cases in {len({t['file'] for t in r})} files")
    summary = step("summarize", lambda: steps.summarize(stack, layers, features), lambda r: r["kind"])

    return {
        "name": root.name,
        "title": ident["title"],
        "summary": ident["summary"],
        "root": str(root),
        "kind": (amap or {}).get("kind") or summary["kind"],
        "stackLine": summary["stackLine"],
        "stack": stack,
        "layers": layers,
        "features": features,
        "flow": flow,
        "notes": amap["notes"] if amap else {},
        "connections": connections,
        "fileLinks": file_links,
        "commands": commands,
        "tests": tests,
        "totalFiles": len(files),
        "truncated": scanned["truncated"],
        "steps": log,
    }
