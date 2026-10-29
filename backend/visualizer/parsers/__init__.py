from __future__ import annotations

from typing import Optional

from ..events import problem
from .checks import parse_build_output, parse_git_status, parse_lint_output, parse_typecheck_output
from .common import (
    ParsedRun,
    ParsedStep,
    classify_command,
    find_file_line,
    normalize_path,
    relativize_run,
    strip_ansi,
)
from .test_output import parse_test_output

__all__ = [
    "ParsedRun", "ParsedStep", "classify_command", "find_file_line", "normalize_path", "relativize_run", "strip_ansi",
    "parse_build_output", "parse_git_status", "parse_lint_output", "parse_typecheck_output", "parse_test_output",
    "parse_command_output",
]


def parse_command_output(command: str, output: str, exit_code: Optional[int] = None) -> ParsedRun:
    """Picks the right parser for a command and reads its finished output."""
    kind = classify_command(command)
    if kind == "test":
        return parse_test_output(output, exit_code)
    if kind == "lint":
        return parse_lint_output(output, exit_code)
    if kind == "typecheck":
        return parse_typecheck_output(output, exit_code)
    if kind == "build":
        return parse_build_output(output, exit_code)
    failed = bool(exit_code)
    return ParsedRun(
        kind="command",
        passed=0 if failed else 1,
        failed=1 if failed else 0,
        problem=problem("The command failed", [f"It exited with code {exit_code}"], "Read the output above, fix the first error, then run it again.") if failed else None,
    )
