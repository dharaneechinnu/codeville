"""One-click connection to Claude Code: adds this app's plugin through Claude Code's own `claude plugin` commands,
so people never type slash commands. A failure comes back as a Problem: what broke, why, and what is next."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .events import problem
from .exe import find_exe
from .gitops import GitProblem

PLUGIN = "code-visualizer"
MARKETPLACE = "code-visualizer"
_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def plugin_dir() -> Path:
    """The plugin folder: next to the backend folder, both when developing and when installed."""
    return Path(__file__).resolve().parents[2] / "plugin"


def _claude() -> str:
    path = find_exe("claude")
    if not path:
        raise GitProblem(problem(
            "Claude Code was not found", ["The app could not find the `claude` command on this computer"],
            "Install Claude Code, open a new terminal to check that `claude` runs, then restart Codeville.",
        ))
    return path


def _run(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            [_claude(), *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, creationflags=_FLAGS,
        )
    except subprocess.TimeoutExpired as err:
        raise GitProblem(problem("Claude Code took too long", [f"`claude {' '.join(args[:2])}` did not finish in {timeout} seconds"], "Check your network, then try again.")) from err


def status() -> dict:
    """Is Claude Code here, and is the plugin installed."""
    if not find_exe("claude"):
        return {"claudeFound": False, "installed": False}
    try:
        r = _run("plugin", "list", timeout=30)
    except GitProblem:
        return {"claudeFound": True, "installed": False}
    installed = f"{PLUGIN}@{MARKETPLACE}" in r.stdout
    return {"claudeFound": True, "installed": installed}


def _said(r: subprocess.CompletedProcess, *words: str) -> bool:
    text = f"{r.stdout}\n{r.stderr}".lower()
    return any(w in text for w in words)


def disconnect() -> dict:
    """Removes the plugin from Claude Code, then the marketplace that held it. Safe to run when it is not installed."""
    gone = _run("plugin", "uninstall", f"{PLUGIN}@{MARKETPLACE}")
    if gone.returncode != 0 and not _said(gone, "not installed", "not found", "no plugin", "unknown", "could not find"):
        last = (gone.stderr or gone.stdout).strip().splitlines()[-1:] or ["claude plugin uninstall failed"]
        raise GitProblem(problem("Could not remove the Codeville plugin from Claude Code", last, "Close other Claude Code windows and try again, or run `/plugin uninstall code-visualizer@code-visualizer` inside Claude Code."))
    _run("plugin", "marketplace", "remove", MARKETPLACE)  # it may already be gone; the plugin is what matters
    return {**status(), "restartNeeded": True}


def connect() -> dict:
    """Adds the plugin folder as a marketplace, then installs the plugin. Safe to run again."""
    folder = plugin_dir()
    if not (folder / ".claude-plugin" / "marketplace.json").is_file():
        raise GitProblem(problem("The Claude Code plugin is missing", [f"Expected it in {folder}"], "Reinstall Codeville."))
    add = _run("plugin", "marketplace", "add", str(folder))
    if add.returncode != 0 and not _said(add, "already"):
        last = (add.stderr or add.stdout).strip().splitlines()[-1:] or ["claude plugin marketplace add failed"]
        raise GitProblem(problem("Could not add the Codeville plugin to Claude Code", last, "Close other Claude Code windows and try again, or use the manual commands."))
    inst = _run("plugin", "install", f"{PLUGIN}@{MARKETPLACE}")
    if inst.returncode != 0 and not _said(inst, "already"):
        last = (inst.stderr or inst.stdout).strip().splitlines()[-1:] or ["claude plugin install failed"]
        raise GitProblem(problem("Could not install the Codeville plugin", last, "Try again, or use the manual commands."))
    return {**status(), "restartNeeded": True}
