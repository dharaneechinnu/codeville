from __future__ import annotations

import re
from typing import Optional

from ..events import problem as make_problem
from .common import ParsedRun, find_file_line, normalize_path, strip_ansi

LINT_ENTRY = re.compile(r"^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}([\w@/-]+))?$")
TSC_A = re.compile(r"^(.+?)\((\d+),\d+\):\s+error\s+TS\d+:\s+(.*)$")
TSC_B = re.compile(r"^(.+?):(\d+):\d+\s+-\s+error\s+TS\d+:\s+(.*)$")
BUILD_ERROR = re.compile(r"\b(error|failed to compile|build failed|cannot find module|module not found|ERR!)\b", re.I)


def _unique(items: list, n: int = 2) -> list:
    seen: list = []
    for i in items:
        if i not in seen:
            seen.append(i)
    return seen[:n]


def parse_lint_output(raw: str, exit_code: Optional[int] = None) -> ParsedRun:
    """ESLint "stylish" output: a path line, then indented `line:col  error  message  rule` lines."""
    file: Optional[str] = None
    found: list = []
    for line in strip_ansi(raw).splitlines():
        if not line.strip():
            continue
        if not line[0].isspace() and (re.search(r"[\\/]", line) or re.search(r"\.\w+$", line)) and not re.search(r"problems?\b", line):
            file = normalize_path(line.strip())
            continue
        m = LINT_ENTRY.match(line)
        if m and file and m.group(3) == "error":
            found.append((file, int(m.group(1)), (m.group(4) or "").strip()))
    failed = len(found)
    prob = None
    if failed:
        first = found[0]
        prob = make_problem(
            "1 lint error" if failed == 1 else f"{failed} lint errors",
            _unique([f[2] for f in found]),
            f"Fix {first[0]}:{first[1]}, then run lint again.",
            file=first[0],
            line=first[1],
        )
    elif exit_code:
        prob = make_problem("Lint did not finish", ["The linter stopped with an error"], "Run it in the terminal and read the first message.")
    return ParsedRun(kind="lint", passed=0 if failed else 1, failed=failed, problem=prob)


def parse_typecheck_output(raw: str, exit_code: Optional[int] = None) -> ParsedRun:
    """TypeScript: `file(12,5): error TS2322: message` or `file:12:5 - error TS2322: message`."""
    found: list = []
    for line in strip_ansi(raw).splitlines():
        m = TSC_A.match(line) or TSC_B.match(line)
        if m:
            found.append((normalize_path(m.group(1)), int(m.group(2)), m.group(3).strip()))
    failed = len(found)
    prob = None
    if failed:
        first = found[0]
        prob = make_problem(
            "1 type error" if failed == 1 else f"{failed} type errors",
            _unique([f[2] for f in found]),
            f"Fix {first[0]}:{first[1]}, then check types again.",
            file=first[0],
            line=first[1],
        )
    elif exit_code:
        prob = make_problem("The type check did not finish", ["tsc stopped with an error"], "Run it in the terminal and read the first message.")
    return ParsedRun(kind="typecheck", passed=0 if failed else 1, failed=failed, problem=prob)


def parse_build_output(raw: str, exit_code: Optional[int] = None) -> ParsedRun:
    """Build tools differ a lot, so this looks for the first clear error line and the file it names."""
    text = strip_ansi(raw)
    lines = text.splitlines()
    error_line = next((l for l in lines if BUILD_ERROR.search(l) and l.strip()), None)
    failed_run = (exit_code is not None and exit_code != 0) or (exit_code is None and error_line is not None)
    if not failed_run:
        return ParsedRun(kind="build", passed=1)
    fl = find_file_line(error_line or "") or find_file_line(text)
    why = [re.sub(r"^\s*(?:error|ERR!)[:\s]*", "", error_line, flags=re.I).strip()] if error_line else ["The build stopped with an error"]
    prob = make_problem(
        "The build failed",
        [w for w in why if w][:2],
        f"Fix {fl[0]}:{fl[1]}, then build again." if fl else "Read the first error in the terminal, fix it, then build again.",
        file=fl[0] if fl else None,
        line=fl[1] if fl else None,
    )
    return ParsedRun(kind="build", failed=1, problem=prob)


def parse_git_status(raw: str) -> dict:
    """`git status --porcelain=v1 -b`"""
    lines = [l for l in raw.splitlines() if l]
    head = next((l for l in lines if l.startswith("## ")), "")
    m = re.match(r"^##\s+(?:No commits yet on\s+)?([^\s.]+(?:/[^\s.]+)*)", head)
    branch = m.group(1) if m else "unknown"
    ahead = re.search(r"ahead (\d+)", head)
    behind = re.search(r"behind (\d+)", head)
    staged = changed = 0
    for l in lines:
        if l.startswith("## ") or len(l) < 3:
            continue
        x, y = l[0], l[1]
        if x not in (" ", "?"):
            staged += 1
        if y != " " or x == "?":
            changed += 1
    return {"branch": branch, "ahead": int(ahead.group(1)) if ahead else 0, "behind": int(behind.group(1)) if behind else 0, "staged": staged, "changed": changed}
