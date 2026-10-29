"""Git actions the app can do for the user: see changes, stage, commit and push. Every call uses git itself,
with no shell, in the project folder. A failure comes back as a Problem: what broke, why, and what is next."""

from __future__ import annotations

import os
import re
import subprocess
from typing import Optional

from .events import problem

_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


class GitProblem(Exception):
    def __init__(self, p: dict):
        super().__init__(p["what"])
        self.problem = p


def _git(cwd: str, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        return subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, creationflags=_FLAGS, env=env,
        )
    except FileNotFoundError as err:
        raise GitProblem(problem("Git is not installed", ["The app could not find git"], "Install Git for Windows, then try again.")) from err
    except subprocess.TimeoutExpired as err:
        raise GitProblem(problem("Git took too long", [f"`git {args[0]}` did not finish in {timeout} seconds"], "Check your network or repository, then try again.")) from err


def _repo_or_raise(cwd: str) -> None:
    r = _git(cwd, "rev-parse", "--is-inside-work-tree", timeout=15)
    if r.returncode != 0:
        raise GitProblem(problem("This folder is not a git repository", ["There is no .git folder here"], "Run `git init` in the project, then try again."))


def branch_name(cwd: str) -> str:
    r = _git(cwd, "rev-parse", "--abbrev-ref", "HEAD", timeout=15)
    name = r.stdout.strip()
    if r.returncode != 0 or name == "HEAD":
        r2 = _git(cwd, "symbolic-ref", "--short", "HEAD", timeout=15)
        name = r2.stdout.strip() or "main"
    return name


def changes(cwd: str) -> dict:
    """Changed files with their staged state and added and removed lines."""
    _repo_or_raise(cwd)
    st = _git(cwd, "status", "--porcelain=v1", "-uall")
    files: dict = {}
    for line in st.stdout.splitlines():
        if len(line) < 4:
            continue
        x, y, path = line[0], line[1], line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        path = path.strip('"').replace("\\", "/")
        staged = x not in (" ", "?")
        unstaged = y != " " or x == "?"
        status = "A" if x in ("A", "?") or y == "?" else "D" if "D" in (x, y) else "M"
        files[path] = {"path": path, "status": status, "staged": staged, "unstaged": unstaged, "add": 0, "del": 0}
    for args in (("diff", "--numstat"), ("diff", "--cached", "--numstat")):
        for line in _git(cwd, *args).stdout.splitlines():
            m = re.match(r"^(\d+|-)\t(\d+|-)\t(.+)$", line)
            if m and m.group(3).replace("\\", "/") in files:
                f = files[m.group(3).replace("\\", "/")]
                f["add"] += int(m.group(1)) if m.group(1) != "-" else 0
                f["del"] += int(m.group(2)) if m.group(2) != "-" else 0
    ahead = 0
    up = _git(cwd, "rev-list", "--count", "@{upstream}..HEAD", timeout=15)
    if up.returncode == 0 and up.stdout.strip().isdigit():
        ahead = int(up.stdout.strip())
    has_upstream = up.returncode == 0
    return {"branch": branch_name(cwd), "ahead": ahead, "hasUpstream": has_upstream, "files": sorted(files.values(), key=lambda f: f["path"])}


def stage(cwd: str, files: list, do_stage: bool) -> None:
    _repo_or_raise(cwd)
    if not files:
        raise GitProblem(problem("No file chosen", ["Nothing was selected"], "Pick the files to stage."))
    if do_stage:
        r = _git(cwd, "add", "--", *files)
    else:
        r = _git(cwd, "restore", "--staged", "--", *files)
        if r.returncode != 0:  # a repository with no commit yet has nothing to restore from
            r = _git(cwd, "rm", "--cached", "-q", "--", *files)
    if r.returncode != 0:
        raise GitProblem(problem("Could not change what is staged", [r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "git refused"], "Check the file names, then try again."))


def commit(cwd: str, message: str) -> dict:
    _repo_or_raise(cwd)
    message = message.strip()
    if not message:
        raise GitProblem(problem("Commit needs a message", ["The message is empty"], "Write what changed in one line."))
    staged = _git(cwd, "diff", "--cached", "--name-only").stdout.split()
    if not staged:
        raise GitProblem(problem("Nothing staged", ["No file is staged"], "Press + on a file, or Stage all."))
    r = _git(cwd, "commit", "-m", message)
    if r.returncode != 0:
        why = (r.stderr or r.stdout).strip().splitlines()
        nxt = "Set your name and email with `git config user.name` and `git config user.email`, then try again." if "user.email" in (r.stderr + r.stdout) or "tell me who you are" in (r.stderr + r.stdout).lower() else "Read the message, fix it, then try again."
        raise GitProblem(problem("The commit failed", [why[0] if why else "git refused"], nxt))
    h = _git(cwd, "rev-parse", "--short", "HEAD").stdout.strip()
    return {"hash": h, "branch": branch_name(cwd), "files": len(staged), "message": message}


def push(cwd: str, set_upstream: bool = False) -> dict:
    _repo_or_raise(cwd)
    branch = branch_name(cwd)
    args = ["push", "-u", "origin", branch] if set_upstream else ["push"]
    r = _git(cwd, *args, timeout=120)
    if r.returncode == 0:
        return {"branch": branch, "commits": max(1, changes(cwd)["ahead"] or 1)}
    err = (r.stderr or r.stdout).strip()
    low = err.lower()
    if "no upstream branch" in low or "has no upstream" in low:
        raise GitProblem(problem("This branch is not on the server yet", [f"{branch} has no upstream branch"], f"Push and set the upstream: origin/{branch}.", file=None))
    if "protected branch" in low or "gh006" in low or "remote rejected" in low and "protected" in low:
        raise GitProblem(problem("Push blocked", [f"{branch} is protected on the server"], "Push a feature branch instead, for example feature/checkout."))
    if "does not appear to be a git repository" in low or "no configured push destination" in low or "no such remote" in low:
        raise GitProblem(problem("There is no remote to push to", ["This repository has no `origin`"], "Add one with `git remote add origin <url>`, then try again."))
    if "rejected" in low and ("non-fast-forward" in low or "fetch first" in low):
        raise GitProblem(problem("Push rejected", ["The server has commits you do not have"], "Pull first (`git pull --rebase`), then push again."))
    if "authentication" in low or "could not read username" in low or "permission denied" in low:
        raise GitProblem(problem("Git could not sign in", ["The server asked for a login"], "Sign in with Git Credential Manager or an SSH key, then try again."))
    raise GitProblem(problem("The push failed", [err.splitlines()[-1] if err else "git refused"], "Read the message, fix it, then try again."))
