"""Reads the output of a test runner: vitest, jest, node --test (TAP), mocha and pytest. It names each test,
says if it passed, and points at the failing line."""

from __future__ import annotations

import re
from typing import Optional

from ..events import problem as make_problem
from .common import ParsedRun, ParsedStep, find_file_line, strip_ansi

PASS = re.compile(r"^\s*(?:✓|√|✔|PASS(?:ED)?\b)\s*(.+?)(?:\s+\(?(\d+(?:\.\d+)?)\s*ms\)?)?\s*$")
FAIL = re.compile(r"^\s*(?:✕|×|✗|✘|FAIL(?:ED)?\b)\s*(.+?)(?:\s+\(?(\d+(?:\.\d+)?)\s*ms\)?)?\s*$")
TAP_OK = re.compile(r"^\s*ok\s+\d+\s*-?\s*(.*?)(?:\s+#\s*(SKIP|skip).*)?$")
TAP_NOT_OK = re.compile(r"^\s*not ok\s+\d+\s*-?\s*(.*)$")
PYTEST = re.compile(r"^(\S+\.py)::(\S+)\s+(PASSED|FAILED|SKIPPED|ERROR)")
PYTEST_FAILED_LINE = re.compile(r"^FAILED\s+(\S+\.py)::(\S+)(?:\s+-\s+(.*))?$")
ERROR_LINE = re.compile(r"(?:\b\w*Error\b|\berror:|\bexpected\b|expect\()", re.I)
BOOKKEEPING = re.compile(r"^\s*(?:name|code|operator|generatedMessage|actual|expected|stack|location|failureType|duration_ms|type)\s*:", re.I)
SUITE_FAIL = re.compile(r"^\s*FAIL\b.*\bsuite\b", re.I)
BARE_PASS = re.compile(r"^\s*PASS\s*$")
TESTS_WORD = re.compile(r"tests?|skipped|passed|failed", re.I)
SKIP_COUNT = re.compile(r"\b(\d+)\s+(?:skipped|pending|todo)\b", re.I)


# What the first error line usually means, and what to do about it. The first match wins.
NOT_RUN = [
    (re.compile(r"Could not read package\.json|no such file or directory.*package\.json", re.I), "There is no package.json in the folder the command ran in",
     "Run the tests from the folder that has package.json (often frontend), or pick another test command."),
    (re.compile(r"No module named ['\"]?([\w.]+)|ModuleNotFoundError", re.I), "A Python package the tests need is missing",
     "Install the project's packages in its virtual environment (pip install -r requirements.txt), then run again."),
    (re.compile(r"Cannot find module|MODULE_NOT_FOUND", re.I), "A Node package the tests need is missing",
     "Run npm install in that folder, then run again."),
    (re.compile(r"is not recognized as an internal or external command|command not found|not found", re.I), "The test command is not installed or not on PATH",
     "Install that tool, or open a new terminal so it is on PATH, then run again."),
    (re.compile(r"connection refused|could not connect|OperationalError|password authentication failed|does not exist.*database|database.*does not exist", re.I), "The tests could not reach their database",
     "Start the database the tests need (for example PostgreSQL), then run again."),
    (re.compile(r"no tests ran|collected 0 items|No tests found|no test files", re.I), "No test cases were found",
     "Check that the tests live where the runner looks, and that their names match its pattern."),
]
FIRST_ERROR = re.compile(r"\b(?:error|errno|exception|failed|fatal)\b", re.I)


def why_not_run(lines: list) -> tuple:
    """The real reason a test command stopped before any test ran, and what to do next, from its own output."""
    text = "\n".join(lines)
    for pattern, why, nxt in NOT_RUN:
        m = pattern.search(text)
        if m:
            detail = next((l.strip() for l in lines if pattern.search(l)), "")
            return (f"{why}. {detail[:160]}" if detail and detail.lower() not in why.lower() else why), nxt
    first = next((re.sub(r"^npm (?:error|ERR!)\s*", "", l.strip()) for l in lines if FIRST_ERROR.search(l)), "")
    last = next((l.strip() for l in reversed(lines) if l.strip()), "")
    return (first or last or "The command stopped with an error and printed nothing")[:200], "Run the command in the terminal and read the first error."


def parse_test_output(raw: str, exit_code: Optional[int] = None) -> ParsedRun:
    lines = strip_ansi(raw).splitlines()
    steps: list = []
    skipped = 0
    last_fail: Optional[ParsedStep] = None

    def attach_detail(step: ParsedStep, line: str) -> None:
        if not step.problem:
            return
        fl = find_file_line(line)
        if fl and step.problem.get("line") is None:
            # The first place the runner points at is the best one to open.
            step.problem["file"], step.problem["line"] = fl
            step.problem["next"] = f"Fix {fl[0]}:{fl[1]}, then run the test again."
        if BOOKKEEPING.match(line):
            return
        if ERROR_LINE.search(line) and len(step.problem["why"]) < 2:
            msg = re.sub(r"^\s*(?:[-❯>→]+\s*)?", "", line)
            msg = re.sub(r"^error:\s*", "", msg, flags=re.I).strip()
            msg = re.sub(r"^'(.*)'$", r"\1", msg)
            if msg and msg not in step.problem["why"]:
                step.problem["why"].append(msg)

    for line in lines:
        py = PYTEST.match(line)
        if py:
            status = py.group(3)
            if status == "SKIPPED":
                skipped += 1
                continue
            ok = status == "PASSED"
            step = ParsedStep(name=py.group(2), path=py.group(1), ok=ok)
            if not ok:
                step.problem = _base_problem(step)
            steps.append(step)
            last_fail = None if ok else step
            continue
        pyf = PYTEST_FAILED_LINE.match(line)
        if pyf:
            existing = next((s for s in steps if not s.ok and s.name == pyf.group(2)), None)
            if existing and existing.problem and pyf.group(3):
                existing.problem["why"] = [pyf.group(3)]
            continue
        tap_not = TAP_NOT_OK.match(line)
        if tap_not:
            step = ParsedStep(name=(tap_not.group(1) or "").strip() or "test", ok=False)
            step.problem = _base_problem(step)
            steps.append(step)
            last_fail = step
            continue
        tap_ok = TAP_OK.match(line)
        if tap_ok:
            if tap_ok.group(2):
                skipped += 1
                continue
            steps.append(ParsedStep(name=(tap_ok.group(1) or "").strip() or "test", ok=True))
            last_fail = None
            continue
        f = FAIL.match(line)
        if f and not SUITE_FAIL.match(line):
            name, path = _split_name(f.group(1) or "test")
            # Runners often print a failed test twice: once as a mark, once as a FAIL heading. Keep one step.
            twin = next((s for s in steps if not s.ok and s.name == name), None)
            if twin:
                if path and not twin.path:
                    twin.path = path
                    if twin.problem and not twin.problem.get("file"):
                        twin.problem["file"] = path
                last_fail = twin
                continue
            step = ParsedStep(name=name, path=path, ok=False, ms=float(f.group(2)) if f.group(2) else None)
            step.problem = _base_problem(step)
            steps.append(step)
            last_fail = step
            continue
        p = PASS.match(line)
        if p and not BARE_PASS.match(line):
            name, path = _split_name(p.group(1) or "test")
            steps.append(ParsedStep(name=name, path=path, ok=True, ms=float(p.group(2)) if p.group(2) else None))
            last_fail = None
            continue
        if last_fail:
            attach_detail(last_fail, line)
        sk = SKIP_COUNT.search(line)
        if sk and TESTS_WORD.search(line):
            skipped = max(skipped, int(sk.group(1)))

    failed = sum(1 for s in steps if not s.ok)
    passed = len(steps) - failed
    first_fail = next((s for s in steps if not s.ok), None)
    prob = first_fail.problem if first_fail and first_fail.problem else None
    if prob is None and exit_code and len(steps) == 0:
        why, nxt = why_not_run(lines)
        prob = make_problem("The tests did not run", [why], nxt)
    return ParsedRun(kind="test", steps=steps, passed=passed, failed=failed, skipped=skipped, problem=prob)


def _split_name(text: str) -> tuple:
    t = re.sub(r"\s*\(\d+\s+tests?[^)]*\)\s*$", "", text, flags=re.I).strip()
    parts = re.split(r"\s+[>›]\s+", t)
    first = parts[0] if parts else t
    if re.search(r"\.(?:tsx?|jsx?|mjs|py|go|rs)\b", first):
        name = " > ".join(parts[1:]) if len(parts) > 1 else first.split("/")[-1]
        return name, first.replace("\\", "/")
    return t, None


def _base_problem(step: ParsedStep) -> dict:
    return make_problem(
        f"{step.name} failed",
        [],
        f"Fix {step.path}, then run the test again." if step.path else "Fix it, then run the test again.",
        file=step.path,
    )
