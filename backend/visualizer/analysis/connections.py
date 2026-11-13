"""The analysis agent's `find_connections` tool. It traces how the buildings of the town are wired together:

- imports: one file uses code from a file in another building
- calls: a frontend file calls an API route that a backend file defines
- stores: a backend file talks to the database
- uses: a file uses an outside service (Stripe, OpenAI, AWS and so on)
- tests: a test file covers a feature

A building is `<feature id>:<layer>`, the database is `database:database` and a service is `svc-<name>:backend`."""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Optional

from .knowledge import DEP_PREFIXES, DEPS

MAX_READ = 60_000
MAX_EDGES = 300
MAX_FILE_LINKS = 800

DB_PACKAGES = {
    "sqlalchemy", "psycopg", "psycopg2", "psycopg2-binary", "asyncpg", "pymongo", "redis", "sqlmodel", "peewee", "databases",
    "pg", "mongoose", "mysql2", "typeorm", "sequelize", "prisma", "@prisma/client", "ioredis", "better-sqlite3", "mysqlclient", "pymysql",
}
HTTP_LINE = re.compile(r"(fetch|axios|\bapi\b|http|request|\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\()", re.I)
LITERAL = re.compile(r"""["'`](/[A-Za-z0-9_\-/${}.:]+)["'`]""")
SKIP_SEGMENTS = {"api", "v1", "v2", "v3", ""}

PY_FROM = re.compile(r"^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$", re.M)
PY_IMPORT = re.compile(r"^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)", re.M)
JS_IMPORT = re.compile(r"""(?:import\s+(?:[^'"]*?\s+from\s+)?|require\(\s*|import\(\s*)['"]([^'"]+)['"]""")
PY_PREFIX = re.compile(r"""APIRouter\([^)]*prefix\s*=\s*["']([^"']+)["']""")
PY_ROUTE = re.compile(r"""@\w+\.(?:get|post|put|patch|delete)\(\s*["']([^"']*)["']""")
JS_ROUTE = re.compile(r"""\.(?:get|post|put|patch|delete|use)\(\s*['"`](/[^'"`]*)['"`]""")


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf8", errors="replace")[:MAX_READ]
    except OSError:
        return ""


def _segment(route: str) -> Optional[str]:
    for part in route.strip("/").split("/"):
        p = part.lower()
        if p in SKIP_SEGMENTS or p.startswith(("{", ":", "$")) or p.isdigit():
            continue
        return re.sub(r"[^a-z0-9-]", "", p) or None
    return None


def _service(top: str, module: str = "") -> Optional[str]:
    low = top.lower().replace("_", "-")
    if module.startswith("google.cloud"):
        return "Google Cloud"
    hit = DEPS.get(low) or next((v for p, v in DEP_PREFIXES.items() if low.startswith(p)), None)
    return hit[1] if hit and hit[0] == "service" else None


def _py_index(paths: list) -> dict:
    idx: dict = {}
    for p in paths:
        if not p.endswith(".py"):
            continue
        parts = p[:-3].split("/")
        if parts[-1] == "__init__":
            parts.pop()
        for k in range(len(parts)):
            if len(parts) - k >= 2 or k == 0:
                idx.setdefault(".".join(parts[k:]), p)
    return idx


def _resolve_py(importer: str, dots: str, module: str, names: list, idx: dict) -> list:
    base = module
    if dots:
        pkg = importer.split("/")[:-1]
        pkg = pkg[: len(pkg) - (len(dots) - 1)] if len(dots) > 1 else pkg
        base = ".".join([*pkg, *([module] if module else [])])
    found = []
    for n in names:
        hit = idx.get(f"{base}.{n}" if base else n)
        if hit:
            found.append(hit)
    if not found and base and idx.get(base):
        found.append(idx[base])
    return found


def _resolve_js(importer: str, spec: str, paths: set) -> Optional[str]:
    if spec.startswith("@/"):
        parts = importer.split("/")
        root = "/".join(parts[: parts.index("src") + 1]) if "src" in parts else ""
        base = f"{root}/{spec[2:]}".lstrip("/")
    elif spec.startswith("."):
        stack = importer.split("/")[:-1]
        for seg in spec.split("/"):
            if seg == "..":
                if stack:
                    stack.pop()
            elif seg not in (".", ""):
                stack.append(seg)
        base = "/".join(stack)
    else:
        return None
    for tail in ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"):
        if base + tail in paths:
            return base + tail
    return None


def find_connections(root: Path, features: list) -> list:
    """Returns the links between buildings as [{from, to, kind, weight}], strongest first."""
    return trace(root, features)[0]


def trace(root: Path, features: list) -> tuple:
    """Traces the project once and returns two lists: the links between buildings, and the links between single files
    (blocks) as [{from, to, kind}] where both ends are file paths."""
    owner: dict = {}
    layer_of: dict = {}
    for f in features:
        for file in f["files"]:
            owner[file["path"]] = f"{f['id']}:{file['layer']}"
            layer_of[file["path"]] = file["layer"]
    paths = set(owner)
    pyidx = _py_index(list(paths))
    edges: Counter = Counter()
    routes: dict = {}
    route_file: dict = {}
    texts: dict = {}
    file_links: dict = {}

    def link(a: str, b: str, kind: str, n: int = 1) -> None:
        if a != b:
            edges[(a, b, kind)] += n

    def flink(a: str, b: str, kind: str) -> None:
        if a != b:
            file_links.setdefault((a, b), kind)

    def inside(path: str, t: str, a: str) -> None:
        """One file of the project uses another."""
        if layer_of.get(t) == "tests":
            return
        kind = "stores" if layer_of.get(t) == "database" else "imports"
        link(a, owner[t], kind)
        flink(path, t, kind)

    for path in sorted(paths):
        text = _read(root / path)
        texts[path] = text
        a = owner[path]
        ext = path.rsplit(".", 1)[-1]
        if layer_of[path] == "tests":
            # A test file covers the files it imports. This only links blocks; the building links stay per feature.
            for t in _imports_of(path, text, ext, pyidx, paths):
                if layer_of.get(t) != "tests":
                    flink(path, t, "tests")
            continue
        if layer_of[path] == "database":
            continue
        if ext == "py":
            for dots, module, names in PY_FROM.findall(text):
                targets = _resolve_py(path, dots, module, [n.strip().split(" as ")[0].strip("() ") for n in names.split(",")], pyidx)
                for t in targets:
                    inside(path, t, a)
                if not dots and not targets:
                    _outside(a, module, link)
            for group in PY_IMPORT.findall(text):
                for module in [m.strip() for m in group.split(",")]:
                    t = pyidx.get(module)
                    if t:
                        inside(path, t, a)
                    else:
                        _outside(a, module, link)
            for prefix in PY_PREFIX.findall(text) + PY_ROUTE.findall(text):
                seg = _segment(prefix)
                if seg:
                    routes.setdefault(seg, a)
                    route_file.setdefault(seg, path)
        elif ext in ("ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"):
            for spec in JS_IMPORT.findall(text):
                t = _resolve_js(path, spec, paths)
                if t:
                    inside(path, t, a)
                elif not spec.startswith("."):
                    top = "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]
                    if top in DB_PACKAGES:
                        link(a, "database:database", "stores")
                    svc = _service(top)
                    if svc:
                        link(a, f"svc-{svc}:backend", "uses")
            if layer_of[path] == "backend":
                for route in JS_ROUTE.findall(text):
                    seg = _segment(route)
                    if seg:
                        routes.setdefault(seg, a)
                        route_file.setdefault(seg, path)

    # A frontend file that writes "/matters" next to fetch or api.get is calling the backend file that defines /matters.
    for path in sorted(paths):
        if layer_of[path] != "frontend":
            continue
        a = owner[path]
        for line in texts.get(path, "").splitlines():
            if not HTTP_LINE.search(line):
                continue
            for lit in LITERAL.findall(line):
                seg = _segment(lit)
                if seg in routes:
                    link(a, routes[seg], "calls")
                    flink(path, route_file[seg], "calls")

    # Each feature's own frontend talks to its own backend, and its tests cover what it has.
    for f in features:
        if f["kind"] != "feature":
            continue
        here = {layer: f"{f['id']}:{layer}" for layer in ("frontend", "backend", "tests") if any(x["layer"] == layer for x in f["files"])}
        if "frontend" in here and "backend" in here and edges.get((here["frontend"], here["backend"], "calls"), 0) == 0:
            edges[(here["frontend"], here["backend"], "calls")] = 1
        if "tests" in here:
            target = here.get("backend") or here.get("frontend")
            if target:
                edges[(here["tests"], target, "tests")] = sum(1 for x in f["files"] if x["layer"] == "tests")

    out = [{"from": a, "to": b, "kind": k, "weight": n} for (a, b, k), n in edges.items()]
    out.sort(key=lambda e: (-e["weight"], e["from"], e["to"]))
    files = [{"from": a, "to": b, "kind": k} for (a, b), k in sorted(file_links.items())]
    return out[:MAX_EDGES], files[:MAX_FILE_LINKS]


def _imports_of(path: str, text: str, ext: str, pyidx: dict, paths: set) -> list:
    """The project files that one file imports."""
    found: list = []
    if ext == "py":
        for dots, module, names in PY_FROM.findall(text):
            found += _resolve_py(path, dots, module, [n.strip().split(" as ")[0].strip("() ") for n in names.split(",")], pyidx)
        for group in PY_IMPORT.findall(text):
            found += [pyidx[m.strip()] for m in group.split(",") if m.strip() in pyidx]
    elif ext in ("ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"):
        found += [t for t in (_resolve_js(path, spec, paths) for spec in JS_IMPORT.findall(text)) if t]
    return found


def _outside(a: str, module: str, link) -> None:
    """An import that points outside the project: a database driver or an outside service."""
    top = module.split(".")[0].lower().replace("_", "-")
    if top in DB_PACKAGES:
        link(a, "database:database", "stores")
    svc = _service(top, module)
    if svc:
        link(a, f"svc-{svc}:backend", "uses")
