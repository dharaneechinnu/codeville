"""The analysis agent's tools. Each one does a single job on a project folder and returns plain data:
scan_files, read_identity, detect_stack, classify_layers, find_features and summarize."""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Optional

from .knowledge import (
    DB_SCHEMES, DEPS, DEP_PREFIXES, DOCKER_IMAGES, ENV_PREFIXES, EXTENSIONS, FEATURE_WORDS, IGNORE_DIRS, LANGUAGES, STOP,
    WORD_TO_FEATURE,
)

MAX_FILES = 5000
MAX_DEPTH = 12
MAX_FEATURES = 20
LAYERS = ("frontend", "backend", "database", "tests")


# ---------------------------------------------------------------------------------------------- scan_files

def scan_files(root: Path) -> dict:
    """Lists the project's source files with their size in lines. Skips build output, packages and hidden folders."""
    files: list = []
    truncated = False

    def walk(directory: Path, depth: int) -> None:
        nonlocal truncated
        if truncated or depth > MAX_DEPTH:
            return
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if len(files) >= MAX_FILES:
                truncated = True
                return
            try:
                if entry.is_dir(follow_symlinks=False):
                    if entry.name in IGNORE_DIRS or entry.name.startswith("."):
                        continue
                    walk(Path(entry.path), depth + 1)
                elif entry.is_file():
                    ext = entry.name.rsplit(".", 1)[-1].lower() if "." in entry.name else ""
                    if ext not in EXTENSIONS:
                        continue
                    rel = Path(entry.path).relative_to(root).as_posix()
                    files.append({"path": rel, "lines": _count_lines(entry.path, entry.stat().st_size), "ext": ext})
            except OSError:
                continue

    walk(root, 0)
    return {"files": files, "truncated": truncated}


def _count_lines(path: str, size: int) -> int:
    if size > 512 * 1024:
        return round(size / 40)
    try:
        text = Path(path).read_text(encoding="utf8", errors="replace")
    except OSError:
        return 0
    return 0 if not text else text.count("\n") + 1


# ---------------------------------------------------------------------------------------------- read_identity

def _read(path: Path, limit: int = 200_000) -> str:
    try:
        return path.read_text(encoding="utf8", errors="replace")[:limit]
    except OSError:
        return ""


def read_identity(root: Path) -> dict:
    """Who this project says it is: the README's title and first useful paragraph, or the package description."""
    title, summary = "", ""
    readme = next((root / n for n in ("README.md", "readme.md", "README.MD", "README.rst", "README.txt") if (root / n).is_file()), None)
    if readme:
        text = _read(readme, 60_000)
        lines = text.splitlines()
        h1 = next((l for l in lines if l.startswith("# ")), "")
        title = re.sub(r"[`*_]", "", h1[2:]).strip()
        summary = _paragraph_after(lines, ("what it does", "overview", "about", "description")) or _first_paragraph(lines)
    if not summary:
        pkg = _json(root / "package.json")
        summary = str(pkg.get("description") or "")
        title = title or str(pkg.get("name") or "")
    return {"title": title or root.name, "summary": summary[:240]}


def _clean(s: str) -> str:
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    return re.sub(r"[`*_]", "", s).strip()


def _first_paragraph(lines: list) -> str:
    buf: list = []
    for l in lines:
        t = l.strip()
        if not t or t.startswith(("#", "|", ">", "![", "<", "```", "- [", "[!")):
            if buf:
                break
            continue
        buf.append(_clean(t))
        if len(" ".join(buf)) > 200:
            break
    return " ".join(buf)


def _paragraph_after(lines: list, names: tuple) -> str:
    for i, l in enumerate(lines):
        if l.lstrip("#").strip().lower() in names and l.startswith("#"):
            return _first_paragraph(lines[i + 1:])
    return ""


# ---------------------------------------------------------------------------------------------- detect_stack

def _json(path: Path) -> dict:
    try:
        v = json.loads(_read(path))
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def _manifest_dirs(root: Path) -> list:
    dirs = [root]
    try:
        for e in sorted(os.scandir(root), key=lambda e: e.name):
            if e.is_dir(follow_symlinks=False) and e.name not in IGNORE_DIRS and not e.name.startswith("."):
                dirs.append(Path(e.path))
    except OSError:
        pass
    return dirs


def _python_deps(text: str) -> set:
    out = set()
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9_.\-]*)", line.split("#")[0])
        if m and not line.lstrip().startswith(("-", "[")):
            out.add(m.group(1).lower().replace("_", "-"))
    return out


def _pyproject_deps(text: str) -> set:
    return {m.lower().replace("_", "-") for m in re.findall(r'["\']([A-Za-z0-9][A-Za-z0-9_.\-]*)\s*(?:[><=~!\[;,]|["\'])', text)}


def detect_stack(root: Path, files: list) -> dict:
    """Frameworks, databases and outside services, read from package files, .env examples and docker-compose."""
    deps: set = set()
    envs: list = []
    images: list = []
    for d in _manifest_dirs(root):
        pkg = d / "package.json"
        if pkg.is_file():
            j = _json(pkg)
            deps |= set((j.get("dependencies") or {}).keys()) | set((j.get("devDependencies") or {}).keys())
        for name in os.listdir(d) if d.is_dir() else []:
            low = name.lower()
            if low.startswith("requirements") and low.endswith(".txt"):
                deps |= _python_deps(_read(d / name))
            elif low == "pyproject.toml":
                deps |= _pyproject_deps(_read(d / name))
            elif low == "go.mod":
                deps |= {l.split()[0] for l in _read(d / name).splitlines() if l.strip().startswith("github.com") or "\t" in l and "/" in l.split()[0]}
            elif low in ("composer.json",):
                deps |= set((_json(d / name).get("require") or {}).keys())
            elif low.startswith(".env") and ("example" in low or "sample" in low or low == ".env"):
                envs += [l.split("=")[0].strip() for l in _read(d / name).splitlines() if "=" in l and not l.lstrip().startswith("#")]
                envs += [l.lstrip("# ").split("=")[0].strip() for l in _read(d / name).splitlines() if l.lstrip().startswith("#") and "=" in l]
                for l in _read(d / name).splitlines():
                    m = re.match(r"^\s*DATABASE_URL\s*=\s*([a-z]+)", l, re.I)
                    if m:
                        envs.append(f"DB:{m.group(1).lower()}")
            elif low.startswith("docker-compose") and low.endswith((".yml", ".yaml")):
                images += re.findall(r"image:\s*['\"]?([A-Za-z0-9_./\-]+)", _read(d / name))

    out = {"frontend": [], "backend": [], "database": [], "services": []}

    def add(kind: str, label: str) -> None:
        key = "services" if kind == "service" else kind
        if label not in out[key]:
            out[key].append(label)

    for dep in sorted(deps):
        low = dep.lower()
        hit = DEPS.get(low) or next((v for p, v in DEP_PREFIXES.items() if low.startswith(p)), None)
        if hit:
            add(*hit)
    for key in envs:
        if key.startswith("DB:"):
            if key[3:] in DB_SCHEMES:
                add("database", DB_SCHEMES[key[3:]])
            continue
        label = next((v for p, v in ENV_PREFIXES.items() if key.upper().startswith(p)), None)
        if label:
            add("service", label)
    for img in images:
        base = img.split("/")[-1].split(":")[0].lower()
        label = next((v for k, v in DOCKER_IMAGES.items() if k in base or k in img.lower()), None)
        if label:
            add("database", label)

    langs = Counter(LANGUAGES[f["ext"]] for f in files if f["ext"] in LANGUAGES and f["ext"] != "sql")
    out["languages"] = [name for name, _ in langs.most_common(3)]
    return out


# ---------------------------------------------------------------------------------------------- classify_layers

_FRONT_DIRS = {"frontend", "client", "web", "ui", "components", "pages", "views", "hooks", "public", "styles"}
_BACK_DIRS = {"backend", "server", "api", "services", "routes", "controllers", "workers", "jobs", "agents", "cmd", "internal"}
_DB_DIRS = {"alembic", "migrations", "migration", "versions", "prisma", "db", "database", "seeds", "seeders", "models", "entities"}
_TEST_DIRS = {"tests", "test", "__tests__", "spec", "specs", "e2e"}


def _layer(path: str, ext: str) -> Optional[str]:
    parts = path.lower().split("/")
    dirs, stem = parts[:-1], re.sub(r"\.[^.]+$", "", parts[-1])
    if any(d in _TEST_DIRS for d in dirs) or stem.startswith("test_") or stem.endswith(("_test", ".test", ".spec")) or ".test." in parts[-1] or ".spec." in parts[-1]:
        return "tests"
    if ext in ("sql", "prisma") or any(d in _DB_DIRS for d in dirs) or stem in ("seed", "seeds"):
        return "database"
    if ext in ("tsx", "jsx", "vue", "svelte"):
        return "frontend"
    if ext in ("py", "go", "rs", "java", "kt", "rb", "php", "cs"):
        return "backend"
    if any(d in _FRONT_DIRS for d in dirs):
        return "frontend"
    if any(d in _BACK_DIRS for d in dirs):
        return "backend"
    return None


def classify_layers(files: list, stack: dict) -> dict:
    """Tags every file as frontend, backend, database or tests. A plain .ts or .js file takes its side from the stack."""
    lone_front = bool(stack["frontend"]) and not stack["backend"]
    counts: Counter = Counter()
    for f in files:
        layer = _layer(f["path"], f["ext"]) or ("frontend" if lone_front else "backend")
        f["layer"] = layer
        counts[layer] += 1
    return {k: counts.get(k, 0) for k in LAYERS}


# ---------------------------------------------------------------------------------------------- find_features

def _tokens(path: str) -> list:
    parts = path.split("/")
    stem = re.sub(r"\.[^.]+$", "", parts.pop() if parts else "")
    out: list = []
    for seg in [*parts, stem]:
        spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", seg).lower()
        out.extend(t for t in re.split(r"[^a-z0-9]+", spaced) if t)
    return out


def _singular(t: str) -> str:
    if t.endswith("ies") and len(t) > 4:
        return t[:-3] + "y"
    if t.endswith(("sses", "xes", "ches", "shes")):
        return t[:-2]
    if t.endswith("s") and not t.endswith(("ss", "ics", "us", "is")) and len(t) > 3:
        return t[:-1]
    return t


SIDE_WORDS = {"client", "clients", "server", "web", "agent", "agents"}
STEM_STOP = {
    "index", "init", "main", "base", "deps", "conftest", "test", "tests", "spec", "types", "type", "utils", "util", "helpers",
    "config", "setup", "mock", "mocks", "fixture", "fixtures", "app", "schemas", "schema", "constants", "const", "styles", "api",
}


def _words(segment: str) -> list:
    spaced = re.sub(r"([a-z0-9])([A-Z])", lambda m: m.group(1) + " " + m.group(2), segment).lower()
    return [t for t in re.split(r"[^a-z0-9]+", spaced) if t]


def _domain(path: str) -> Optional[str]:
    """The first word that says what a file is about. Folder names like `services` or `client` only say where it lives,
    but a file called `clients.py` is about clients."""
    parts = path.split("/")
    stem = re.sub(r"\.[^.]+$", "", parts[-1])
    for pos, (seg, is_stem) in enumerate([*((p, False) for p in parts[:-1]), (stem, True)]):
        # A top-level `client/` folder only says where files live, but `features/clients/` is a feature.
        stop = STEM_STOP if is_stem else (STOP if pos == 0 else STOP - SIDE_WORDS)
        for t in _words(seg):
            n = _singular(t)
            skip = t in stop or n in stop
            if skip or len(n) < 3 or n.isdigit():
                continue
            return n
    return None


def _feature_name(domain: str) -> str:
    return WORD_TO_FEATURE.get(domain) or WORD_TO_FEATURE.get(domain + "s") or domain.replace("-", " ").title()


def find_features(files: list) -> list:
    """Groups files by what they are about, across frontend, backend and tests, so one feature shows all its layers.
    Database files form one building of their own."""
    groups: dict = {}
    db_files: list = []
    loose: list = []
    for f in files:
        if f["layer"] == "database":
            db_files.append(f)
            continue
        d = _domain(f["path"])
        if d is None:
            loose.append(f)
        else:
            groups.setdefault(_feature_name(d), []).append(f)

    # A word that only one file has is not a feature yet. Those files go to the leftovers.
    leftovers = list(loose)
    for name in [n for n, lst in groups.items() if len(lst) < 2 and n not in FEATURE_WORDS]:
        leftovers += groups.pop(name)
    ranked = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    keep = dict(ranked[:MAX_FEATURES - 2])
    for name, lst in ranked[MAX_FEATURES - 2:]:
        leftovers += lst
    shell = [f for f in leftovers if f["layer"] == "frontend"]
    core = [f for f in leftovers if f["layer"] != "frontend"]

    out = []
    for name, lst in [*keep.items(), ("App shell", shell), ("Core", core)]:
        if lst:
            out.append(_feature("feature", name, lst))
    out.sort(key=lambda f: (f["id"] in ("core", "app-shell"), -len(f["files"])))
    if db_files:
        out.append(_feature("database", "Database", db_files))
    return out


def _feature(kind: str, name: str, files: list) -> dict:
    srt = sorted(files, key=lambda f: f["path"])
    layers = Counter(f["layer"] for f in srt)
    return {
        "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"), "name": name, "kind": kind,
        "path": _short_path(srt), "files": srt, "layers": {k: layers.get(k, 0) for k in LAYERS},
    }


def _short_path(files: list) -> str:
    if not files:
        return ""
    main = max(files, key=lambda f: f["lines"])
    return "/".join(re.sub(r"\.[^.]+$", "", main["path"]).split("/")[-2:])


# ---------------------------------------------------------------------------------------------- summarize

def summarize(stack: dict, layers: dict, features: list) -> dict:
    """A short label for what kind of project this is, and one line describing its stack."""
    names = {f["name"] for f in features}
    has_front = bool(stack["frontend"]) or layers["frontend"] > 0
    has_back = bool(stack["backend"]) or layers["backend"] > 0
    if "Cart" in names or len(names & {"Payment", "Products"}) == 2:
        kind = "Online shop"
    elif "Blog" in names:
        kind = "Blog"
    elif has_front and has_back:
        kind = "Full-stack web app"
    elif has_front:
        kind = "Web app"
    elif has_back:
        kind = "API / backend"
    else:
        kind = "Software project"
    parts = [*stack["frontend"][:3], *stack["backend"][:3], *stack["database"][:3]]
    return {"kind": kind, "stackLine": " · ".join(parts)}
