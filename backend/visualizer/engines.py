"""AI engines that are native command-line tools already signed in on this computer: Claude Code and GitHub Copilot CLI.

Codeville never sees a key or a token for these. It starts the tool the same way a person would in a terminal, and the
tool answers with the account it is signed in to. Signing in is the tool's own flow (`claude auth login`,
`copilot login`); Codeville only opens it.

The prompt always goes in on standard input, never as a command-line argument. A whole file fits that way, and on
Windows nothing a person typed is ever read by cmd.exe on the way to an npm `.cmd` launcher.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from .config import config_dir
from .events import problem
from .exe import find_exe

TIMEOUT = 180
_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

# ask: one question, text back, no tools (the editor's AI prompt and the Test button).
# agent: works in the project folder (the Chat). `edits` is added when the user lets it edit files without asking.
# Neither tool is ever given a blanket "allow everything" flag: Copilot gets file writes only, never the shell.
ENGINES: dict = {
    "claude": {
        "label": "Claude Code", "bin": "claude", "account": "Anthropic",
        "install": "npm install -g @anthropic-ai/claude-code", "url": "https://claude.com/claude-code",
        "login": ["auth", "login"],
        "ask": ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence"],
        "agent": ["-p"], "edits": ["--permission-mode", "acceptEdits"],
        "models": ["default", "sonnet", "opus", "haiku"],
    },
    "copilot": {
        "label": "GitHub Copilot CLI", "bin": "copilot", "account": "GitHub",
        "install": "npm install -g @github/copilot", "url": "https://github.com/features/copilot/cli",
        "login": ["login"],
        "ask": ["-s", "--no-color", "--no-ask-user", "--no-custom-instructions", "--stream", "off"],
        "agent": ["-s", "--no-color", "--no-ask-user"], "edits": ["--allow-tool=write"],
        "models": ["default", "auto"],
    },
}

_SIGNED_OUT = re.compile(
    r"no authentication information|not logged in|please run /login|invalid api key|not authenticated|please log in|"
    r"sign[ -]?in required|could not be validated|authentication_error|token (has )?expired|\b401\b|unauthorized", re.I)
_LIMIT = re.compile(r"usage limit|rate limit|quota|credit balance|premium requests?|\b429\b|\b402\b", re.I)
_MODEL = re.compile(r"(doesn't|does not) recognize the model|model\b.{0,60}(not found|not available|unknown|invalid|not supported|does not exist)|(unknown|invalid|unsupported) model", re.I)


class EngineProblem(Exception):
    def __init__(self, p: dict, status: int = 400):
        super().__init__(p["what"])
        self.problem = p
        self.status = status


def spec(engine: str) -> dict:
    if engine not in ENGINES:
        raise EngineProblem(problem("That AI engine is not supported", [f"Got {engine!r}"], "Pick Claude Code or GitHub Copilot CLI."))
    return ENGINES[engine]


def find(engine: str) -> Optional[str]:
    return find_exe(spec(engine)["bin"])


def need(engine: str, exe: Optional[str] = None) -> str:
    s = spec(engine)
    path = exe or find(engine)
    if not path:
        raise EngineProblem(problem(
            f"{s['label']} was not found", [f"The `{s['bin']}` command is not on this computer"],
            f"Install it with `{s['install']}`, then press Check again in Extensions, AI engines.",
        ))
    return path


def login_command(engine: str) -> str:
    s = spec(engine)
    return " ".join([s["bin"], *s["login"]])


def _model_args(model: Optional[str]) -> list:
    m = (model or "").strip()
    return ["--model", m] if m and m != "default" else []


def ask_command(engine: str, model: Optional[str] = None, exe: Optional[str] = None) -> list:
    return [need(engine, exe), *spec(engine)["ask"], *_model_args(model)]


def agent_command(engine: str, model: Optional[str] = None, accept_edits: bool = True, exe: Optional[str] = None) -> list:
    s = spec(engine)
    return [need(engine, exe), *s["agent"], *_model_args(model), *(s["edits"] if accept_edits else [])]


def child_env(quiet: bool = False) -> dict:
    env = dict(os.environ)
    env["NO_COLOR"] = "1"
    if quiet:
        env["CODEVILLE_QUIET"] = "1"  # the Codeville plugin stays silent: a one-off question is not a coding session
    return env


# ---------- status: is it installed, and which account is it signed in to ----------

def _run(args: list, timeout: int = 15) -> Optional[subprocess.CompletedProcess]:
    try:
        return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                              stdin=subprocess.DEVNULL, env=child_env(), creationflags=_FLAGS)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _version(exe: str) -> str:
    r = _run([exe, "--version"])
    lines = ((r.stdout or r.stderr) if r else "").strip().splitlines()
    return lines[0].strip().rstrip(".")[:60] if lines else ""


def _claude_account(exe: str) -> dict:
    """`claude auth status` prints JSON such as {"loggedIn": true, "authMethod": "claude.ai", "email": "..."}."""
    r = _run([exe, "auth", "status"])
    try:
        data = json.loads(r.stdout[r.stdout.index("{"):r.stdout.rindex("}") + 1]) if r else None
    except ValueError:
        data = None
    if not isinstance(data, dict) or "loggedIn" not in data:
        return {"state": "unknown", "name": ""}
    if not data["loggedIn"]:
        return {"state": "signedOut", "name": ""}
    how = str(data.get("authMethod") or "")
    name = data.get("email") or data.get("orgName") or ("API key" if "key" in how.lower() else "Anthropic account")
    return {"state": "signedIn", "name": str(name)}


def _copilot_account(exe: str) -> dict:
    """Copilot has no status command. A token in the environment or a remembered login in its config says signed in;
    otherwise the token may still be in the system credential store, so the honest answer is "unknown": Test settles it."""
    for var in ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(var):
            return {"state": "signedIn", "name": f"token in {var}"}
    home = Path(os.environ.get("COPILOT_HOME") or Path.home() / ".copilot")
    try:
        data = json.loads((home / "config.json").read_text(encoding="utf8"))
    except (OSError, ValueError):
        return {"state": "unknown", "name": ""}
    for key in ("last_logged_in_user", "lastLoggedInUser", "logged_in_users", "loggedInUsers"):
        user = data.get(key) if isinstance(data, dict) else None
        if isinstance(user, list):
            user = user[0] if user else None
        if isinstance(user, dict) and user.get("login"):
            return {"state": "signedIn", "name": str(user["login"])}
    return {"state": "unknown", "name": ""}


_ACCOUNT = {"claude": _claude_account, "copilot": _copilot_account}


def _one(engine: str) -> dict:
    s = ENGINES[engine]
    exe = find(engine)
    out = {
        "id": engine, "label": s["label"], "provider": f"{engine}-cli", "accountKind": s["account"], "found": bool(exe),
        "version": "", "account": {"state": "unknown", "name": ""}, "install": s["install"], "url": s["url"],
        "loginCommand": login_command(engine), "models": s["models"],
    }
    if exe:
        out["version"] = _version(exe)
        out["account"] = _ACCOUNT[engine](exe)
    return out


_cache: dict = {"at": 0.0, "data": None}
_cache_lock = threading.Lock()
CACHE_SECONDS = 30


def forget() -> None:
    with _cache_lock:
        _cache["data"] = None


def status(refresh: bool = False) -> list:
    """Every engine: installed or not, its version, and the account it is signed in to. Remembered for a short while,
    because asking each tool takes a second or two."""
    with _cache_lock:
        if not refresh and _cache["data"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]
    with ThreadPoolExecutor(max_workers=len(ENGINES)) as pool:
        data = list(pool.map(_one, ENGINES))
    with _cache_lock:
        _cache.update(at=time.time(), data=data)
    return data


# ---------- sign in: the tool's own flow, in a terminal the user can see ----------

def _open_terminal(cmd: list) -> bool:
    try:
        if os.name == "nt":
            subprocess.Popen(["cmd.exe", "/k", *cmd], creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
            return True
        line = shlex.join(cmd)
        if sys.platform == "darwin":
            script = f'tell application "Terminal"\nactivate\ndo script {json.dumps(line)}\nend tell'
            subprocess.Popen(["osascript", "-e", script])
            return True
        if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
            return False  # no desktop to open a window on
        for term, flag in (("x-terminal-emulator", "-e"), ("gnome-terminal", "--"), ("konsole", "-e"), ("xterm", "-e")):
            path = shutil.which(term)
            if path:
                subprocess.Popen([path, flag, *cmd])
                return True
    except OSError:
        pass
    return False


def login(engine: str) -> dict:
    """Opens the tool's sign-in in a terminal window. When no terminal can be opened, the command comes back so the
    window can show it for the user to run."""
    s = spec(engine)
    exe = need(engine)
    opened = _open_terminal([exe, *s["login"]])
    forget()
    return {"engine": engine, "opened": opened, "command": login_command(engine)}


# ---------- ask: one question in, text out ----------

def explain(engine: str, model: Optional[str], code: Optional[int], text: str) -> dict:
    """Turns what the tool printed when it failed into what broke and what to do next."""
    s = spec(engine)
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    why = [lines[0][:240]] if lines else []
    if _SIGNED_OUT.search(text):
        return problem(f"{s['label']} is not signed in", why or [f"No {s['account']} account is connected to it"],
                       f"Press Sign in in Extensions, AI engines, or run `{login_command(engine)}` in a terminal. Then press Test.")
    if _LIMIT.search(text):
        return problem(f"{s['label']} says the account hit a limit", why, "Wait and try again, or switch to another engine in Extensions.")
    if _MODEL.search(text):
        return problem(f"{s['label']} does not know the model {model or 'default'}", why, "Type another model name, or use default.")
    return problem(f"{s['label']} stopped with an error" + (f" (exit {code})" if code else ""), why or ["It printed nothing"],
                   f"Run `{s['bin']}` in a terminal to see what it needs, then try again.")


def ask(engine: str, text: str, model: Optional[str] = None, cwd: Optional[str] = None, timeout: int = TIMEOUT) -> str:
    s = spec(engine)
    args = ask_command(engine, model)
    where = cwd or config_dir()
    try:
        Path(where).mkdir(parents=True, exist_ok=True)
        r = subprocess.run(args, input=text, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=timeout, cwd=str(where), env=child_env(quiet=True), creationflags=_FLAGS)
    except subprocess.TimeoutExpired:
        raise EngineProblem(problem(f"{s['label']} took too long to answer", [f"No reply within {timeout} seconds"],
                                    "Try a smaller file or a faster model."), 504) from None
    except OSError as e:
        raise EngineProblem(problem(f"{s['label']} could not be started", [str(e)], f"Reinstall it with `{s['install']}`."), 502) from None
    reply = (r.stdout or "").strip()
    if r.returncode != 0 or not reply:
        forget()
        raise EngineProblem(explain(engine, model, r.returncode, f"{r.stderr or ''}\n{r.stdout or ''}"), 502)
    return reply
