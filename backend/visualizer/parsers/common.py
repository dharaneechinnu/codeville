from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# `path/to/file.ext:12` or `path/to/file.ext:12:5` or `file.ext(12,5)`
FILE_LINE = re.compile(
    r"((?:[A-Za-z]:)?[\w@./\\-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|rb|php|cs|vue|svelte|sql))(?:[:(](\d+))(?:[:,]\d+)?\)?"
)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def strip_ansi(s: str) -> str:
    return ANSI.sub("", s)


def normalize_path(p: str, cwd: Optional[str] = None) -> str:
    """Short, forward-slash paths. Some tools print doubled backslashes, so repeated slashes are squeezed."""
    out = p.replace("\\", "/")
    out = re.sub(r"^file:///?", "", out)
    out = re.sub(r"/{2,}", "/", out)
    if cwd:
        base = re.sub(r"/{2,}", "/", cwd.replace("\\", "/")).rstrip("/") + "/"
        if out.lower().startswith(base.lower()):
            out = out[len(base):]
    return re.sub(r"^\./", "", out)


def find_file_line(text: str) -> Optional[tuple]:
    m = FILE_LINE.search(text)
    if not m or not m.group(1) or not m.group(2):
        return None
    return normalize_path(m.group(1)), int(m.group(2))


@dataclass
class ParsedStep:
    name: str
    ok: bool = True
    path: Optional[str] = None
    ms: Optional[float] = None
    problem: Optional[dict] = None


@dataclass
class ParsedRun:
    kind: str
    steps: list = field(default_factory=list)
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    problem: Optional[dict] = None


def classify_command(command: str) -> str:
    c = command.lower()
    if re.search(r"\b(vitest|jest|mocha|pytest|playwright\s+test|cypress\s+run|go\s+test|cargo\s+test|dotnet\s+test|node\s+--test)\b", c):
        return "test"
    if re.search(r"\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b", c):
        return "test"
    if re.search(r"\beslint\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?lint\b|\bruff\b|\bflake8\b", c):
        return "lint"
    if re.search(r"\btsc\b|\btypecheck\b|\btype-check\b|\bmypy\b|\bpyright\b", c):
        return "typecheck"
    if re.search(r"\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bvite\s+build\b|\bnext\s+build\b|\bwebpack\b|\besbuild\b|\bcargo\s+build\b|\bgo\s+build\b", c):
        return "build"
    return "command"


def relativize_run(run: ParsedRun, cwd: Optional[str]) -> ParsedRun:
    """Makes every path in a finished run relative to the project folder, so messages stay short."""
    if not cwd:
        return run

    def rel(p: Optional[str]) -> Optional[str]:
        return normalize_path(p, cwd) if p else p

    def fix(pr: Optional[dict]) -> Optional[dict]:
        if not pr:
            return pr
        file = rel(pr.get("file"))
        nxt = pr.get("next", "")
        if pr.get("file") and file and pr["file"] != file:
            nxt = nxt.replace(pr["file"], file)
        nxt = re.sub(r"[A-Za-z]:[\\/][^\s:,]+", lambda m: normalize_path(m.group(0), cwd), nxt)
        return {**pr, "file": file, "next": nxt}

    return ParsedRun(
        kind=run.kind,
        passed=run.passed,
        failed=run.failed,
        skipped=run.skipped,
        problem=fix(run.problem),
        steps=[ParsedStep(name=s.name, ok=s.ok, path=rel(s.path), ms=s.ms, problem=fix(s.problem)) for s in run.steps],
    )
