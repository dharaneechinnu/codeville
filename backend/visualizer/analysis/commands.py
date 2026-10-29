"""The analysis agent's `find_commands` and `find_tests` tools.

find_commands looks in the project folder and the folders directly inside it (frontend, backend and so on) for the
project's own test, lint, type check and build commands, so the app runs the right command in the right folder.
find_tests reads the test files and lists the test cases written in them, so the Test view can show them before a run."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .knowledge import IGNORE_DIRS

MAX_TESTS = 600
NO_TEST_SCRIPT = re.compile(r"no test specified", re.I)
SCRIPT_NAMES = {
    "test": ["test"],
    "lint": ["lint"],
    "typecheck": ["typecheck", "type-check", "tsc"],
    "build": ["build"],
}

PY_TEST = re.compile(r"^\s*(?:async\s+)?def\s+(test_\w+)", re.M)
JS_TEST = re.compile(r"""(?:^|[^\w.])(?:it|test)(?:\.(?:only|skip|concurrent))?\s*\(\s*(['"`])(.+?)\1""", re.M)


def _read(path: Path, limit: int = 200_000) -> str:
    try:
        return path.read_text(encoding="utf8", errors="replace")[:limit]
    except OSError:
        return ""


def _folders(root: Path) -> list:
    out = [root]
    try:
        for e in sorted(os.scandir(root), key=lambda e: e.name):
            if e.is_dir(follow_symlinks=False) and e.name not in IGNORE_DIRS and not e.name.startswith("."):
                out.append(Path(e.path))
    except OSError:
        pass
    return out


def _python(folder: Path) -> str:
    """The project's own Python when it has a virtual environment, so its installed packages are used."""
    win = folder / ".venv" / "Scripts" / "python.exe"
    if win.is_file():
        return r".venv\Scripts\python.exe" if os.name == "nt" else ".venv/Scripts/python.exe"
    nix = folder / ".venv" / "bin" / "python"
    if nix.is_file():
        return ".venv/bin/python"
    return "python"


def _has_py_tests(folder: Path) -> bool:
    if any((folder / n).is_file() for n in ("pytest.ini", "conftest.py")):
        return True
    if "[tool.pytest" in _read(folder / "pyproject.toml", 40_000) or "[pytest]" in _read(folder / "tox.ini", 20_000):
        return True
    tests = folder / "tests"
    if tests.is_dir():
        try:
            return any(n.name.startswith("test_") or n.name.endswith("_test.py") for n in os.scandir(tests) if n.name.endswith(".py"))
        except OSError:
            return False
    return False


def find_commands(root: Path) -> list:
    """[{id, kind, label, command, cwd}] with cwd relative to the project folder ('' for the folder itself)."""
    found: list = []
    seen: set = set()

    def add(kind: str, command: str, folder: Path, tool: str) -> None:
        cwd = "" if folder == root else folder.relative_to(root).as_posix()
        if (cwd, command) in seen:
            return
        seen.add((cwd, command))
        area = cwd or root.name
        found.append({"id": f"{kind}:{cwd or '.'}:{len(found)}", "kind": kind, "label": f"{area} · {tool}", "command": command, "cwd": cwd})

    for folder in _folders(root):
        pkg = folder / "package.json"
        if pkg.is_file():
            try:
                scripts = json.loads(_read(pkg)).get("scripts") or {}
            except ValueError:
                scripts = {}
            runner = "pnpm" if (folder / "pnpm-lock.yaml").is_file() else "yarn" if (folder / "yarn.lock").is_file() else "npm"
            for kind, names in SCRIPT_NAMES.items():
                for n in names:
                    body = scripts.get(n)
                    if not isinstance(body, str) or (kind == "test" and NO_TEST_SCRIPT.search(body)):
                        continue
                    add(kind, f"{runner} test" if n == "test" else f"{runner} run {n}", folder, f"{runner} {n}")
                    break
        py = _python(folder)
        if _has_py_tests(folder):
            add("test", f"{py} -m pytest -q", folder, "pytest")
        text = _read(folder / "pyproject.toml", 40_000)
        if (folder / "ruff.toml").is_file() or (folder / ".ruff.toml").is_file() or "[tool.ruff" in text:
            add("lint", f"{py} -m ruff check .", folder, "ruff")
        if (folder / "mypy.ini").is_file() or "[tool.mypy" in text:
            add("typecheck", f"{py} -m mypy .", folder, "mypy")
        if (folder / "go.mod").is_file():
            add("test", "go test ./...", folder, "go test")
            add("build", "go build ./...", folder, "go build")
        if (folder / "Cargo.toml").is_file():
            add("test", "cargo test", folder, "cargo test")
            add("build", "cargo build", folder, "cargo build")

    order = {"test": 0, "lint": 1, "typecheck": 2, "build": 3}
    found.sort(key=lambda c: order[c["kind"]])
    return found


def find_tests(root: Path, files: list, commands: list) -> list:
    """The test cases written in the project's test files: [{file, name, line, cwd}], where cwd is the folder whose test command runs them."""
    test_cwds = sorted({c["cwd"] for c in commands if c["kind"] == "test"}, key=len, reverse=True)
    out: list = []
    for f in files:
        if f.get("layer") != "tests":
            continue
        text = _read(root / f["path"], 120_000)
        if f["ext"] == "py":
            hits = [(m.start(1), m.group(1)) for m in PY_TEST.finditer(text)]
        elif f["ext"] in ("ts", "tsx", "js", "jsx", "mjs", "cjs"):
            hits = [(m.start(2), m.group(2)) for m in JS_TEST.finditer(text)]
        else:
            continue
        cwd = next((c for c in test_cwds if c == "" or f["path"].startswith(c + "/")), "")
        for pos, name in hits:
            out.append({"file": f["path"], "name": name, "line": text.count("\n", 0, pos) + 1, "cwd": cwd})
            if len(out) >= MAX_TESTS:
                return out
    return out
