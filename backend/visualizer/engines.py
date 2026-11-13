"""AI engines: the coding agents people already have as command-line tools, signed in on this computer. Claude Code,
GitHub Copilot CLI, Codex CLI, Gemini CLI, OpenCode, Qwen Code and Amp.

Codeville never sees a key or a token for these. It starts the tool the same way a person would in a terminal, and the
tool answers with the account it is signed in to. Signing in is the tool's own flow (`claude auth login`,
`copilot login`, `codex login`, ...); Codeville only opens it.

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

# One row per tool. Every flag here was read from the tool's own --help, and each tool was run to see that it takes the
# prompt on standard input.
#   ask     one question, text back, nothing changed on disk (the editor's AI prompt and the Test button)
#   agent   works in the project folder (the Chat)
#   edits   added to `agent` when the user lets it edit files without asking; `noedits` when not
#   model   the flag that picks a model, or None when the tool has no such flag
#   status  a command that prints who is signed in; tokens / creds are the fallback (environment variables that hold
#           a key, and files under the home folder that hold a saved sign-in)
#   login   the tool's own sign-in command; empty means "start the tool, it asks on first run"
# No tool is ever given a blanket "allow everything" flag (--yolo, --allow-all-tools, --dangerously-...).
ENGINES: dict = {
    "claude": {
        "label": "Claude Code", "by": "Anthropic", "bin": "claude", "account": "Anthropic",
        "install": "npm install -g @anthropic-ai/claude-code", "url": "https://claude.com/claude-code",
        "login": ["auth", "login"], "status": ["auth", "status"], "tokens": [], "creds": [],
        "ask": ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence"],
        "agent": ["-p"], "edits": ["--permission-mode", "acceptEdits"], "noedits": [],
        "model": "--model", "models": ["default", "sonnet", "opus", "haiku"],
    },
    "copilot": {
        "label": "GitHub Copilot CLI", "by": "GitHub", "bin": "copilot", "account": "GitHub",
        "install": "npm install -g @github/copilot", "url": "https://github.com/features/copilot/cli",
        "login": ["login"], "status": None, "tokens": ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"], "creds": [],
        "ask": ["-s", "--no-color", "--no-ask-user", "--no-custom-instructions", "--stream", "off"],
        "agent": ["-s", "--no-color", "--no-ask-user"], "edits": ["--allow-tool=write"], "noedits": [],
        "model": "--model", "models": ["default", "auto"],
    },
    "codex": {
        "label": "Codex CLI", "by": "OpenAI", "bin": "codex", "account": "OpenAI",
        "install": "npm install -g @openai/codex", "url": "https://developers.openai.com/codex/cli",
        "login": ["login"], "status": ["login", "status"], "tokens": [], "creds": [],
        "ask": ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never"],
        "agent": ["exec", "--skip-git-repo-check", "--color", "never"],
        "edits": ["--sandbox", "workspace-write"], "noedits": ["--sandbox", "read-only"],
        "model": "--model", "models": ["default"],
    },
    "gemini": {
        "label": "Gemini CLI", "by": "Google", "bin": "gemini", "account": "Google",
        "install": "npm install -g @google/gemini-cli", "url": "https://geminicli.com",
        "login": [], "status": None, "tokens": ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "creds": [".gemini/oauth_creds.json"],
        "ask": ["--approval-mode", "plan", "-o", "text"],
        "agent": ["--skip-trust", "-o", "text"], "edits": ["--approval-mode", "auto_edit"], "noedits": ["--approval-mode", "plan"],
        "model": "--model", "models": ["default"],
    },
    "opencode": {
        "label": "OpenCode", "by": "open source", "bin": "opencode", "account": "model provider",
        "install": "npm install -g opencode-ai", "url": "https://opencode.ai",
        "login": ["auth", "login"], "status": None, "tokens": [], "creds": [".local/share/opencode/auth.json"],
        "ask": ["run", "--agent", "plan"],
        "agent": ["run"], "edits": [], "noedits": ["--agent", "plan"],
        "model": "--model", "models": ["default"],
    },
    "qwen": {
        "label": "Qwen Code", "by": "Alibaba", "bin": "qwen", "account": "Qwen",
        "install": "npm install -g @qwen-code/qwen-code", "url": "https://github.com/QwenLM/qwen-code",
        "login": [], "status": None, "tokens": ["DASHSCOPE_API_KEY"], "creds": [".qwen/oauth_creds.json"],
        "ask": ["--approval-mode", "plan"],
        "agent": [], "edits": ["--approval-mode", "auto-edit"], "noedits": ["--approval-mode", "plan"],
        "model": "--model", "models": ["default"],
    },
    "amp": {
        "label": "Amp", "by": "Sourcegraph", "bin": "amp", "account": "Amp",
        "install": "npm install -g @sourcegraph/amp", "url": "https://ampcode.com",
        "login": ["login"], "status": None, "tokens": ["AMP_API_KEY"], "creds": [],
        "ask": ["-x", "--no-color"],
        "agent": ["-x", "--no-color"], "edits": [], "noedits": [],
        "model": None, "models": [],
    },
}

_SIGNED_OUT = re.compile(
    r"no authentication information|not logged in|please run /login|invalid api key|not authenticated|please log in|"
    r"sign[ -]?in required|could not be validated|authentication_error|token (has )?expired|\b401\b|unauthorized|"
    r"set an auth method|no auth type is selected|login failed|run .{0,20}\blogin\b", re.I)
_LIMIT = re.compile(r"usage limit|rate limit|quota|credit balance|premium requests?|\b429\b|\b402\b", re.I)
_MODEL = re.compile(r"(doesn't|does not) recognize the model|model\b.{0,60}(not found|not available|unknown|invalid|not supported|does not exist)|(unknown|invalid|unsupported) model", re.I)


class EngineProblem(Exception):
    def __init__(self, p: dict, status: int = 400):
        super().__init__(p["what"])
        self.problem = p
        self.status = status


def spec(engine: str) -> dict:
    if engine not in ENGINES:
        raise EngineProblem(problem("That AI engine is not supported", [f"Got {engine!r}"], "Pick one from the AI engines page."))
    return ENGINES[engine]


def find(engine: str) -> Optional[str]:
    return find_exe(spec(engine)["bin"])


def need(engine: str, exe: Optional[str] = None) -> str:
    s = spec(engine)
    path = exe or find(engine)
    if not path:
        raise EngineProblem(problem(
            f"{s['label']} was not found", [f"The `{s['bin']}` command is not on this computer"],
            f"Install it with `{s['install']}`, then press Check again on the AI engines page.",
        ))
    return path


def login_command(engine: str) -> str:
    s = spec(engine)
    return " ".join([s["bin"], *s["login"]])


def ask_dir() -> Path:
    """An empty folder for one-off questions. Some tools can read files even when they may not change them, so they
    are never started next to Codeville's own settings."""
    return Path(config_dir()) / "ask"


def _model_args(engine: str, model: Optional[str]) -> list:
    flag, m = spec(engine)["model"], (model or "").strip()
    return [flag, m] if flag and m and m != "default" else []


def ask_command(engine: str, model: Optional[str] = None, exe: Optional[str] = None) -> list:
    return [need(engine, exe), *spec(engine)["ask"], *_model_args(engine, model)]


def agent_command(engine: str, model: Optional[str] = None, accept_edits: bool = True, exe: Optional[str] = None) -> list:
    s = spec(engine)
    return [need(engine, exe), *s["agent"], *_model_args(engine, model), *(s["edits"] if accept_edits else s["noedits"])]


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
    return re.sub(r"\s*\(released.*", "", lines[0].strip()).rstrip(".")[:60] if lines else ""


def _home() -> Path:
    return Path.home()


def _from_status(engine: str, exe: str) -> Optional[dict]:
    """Asks the tool itself. Claude Code prints JSON such as {"loggedIn": true, "email": "..."}; Codex prints a line
    such as "Logged in using ChatGPT" or "Not logged in"."""
    r = _run([exe, *ENGINES[engine]["status"]])
    text = f"{r.stdout or ''}\n{r.stderr or ''}" if r else ""
    try:
        data = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except ValueError:
        data = None
    if isinstance(data, dict) and "loggedIn" in data:
        if not data["loggedIn"]:
            return {"state": "signedOut", "name": ""}
        how = str(data.get("authMethod") or "")
        name = data.get("email") or data.get("orgName") or ("API key" if "key" in how.lower() else f"{ENGINES[engine]['account']} account")
        return {"state": "signedIn", "name": str(name)}
    if re.search(r"not logged in|logged out|not authenticated", text, re.I):
        return {"state": "signedOut", "name": ""}
    m = re.search(r"logged in(?: (?:using|with|as) ([^\n]{1,40}))?", text, re.I)
    if m:
        return {"state": "signedIn", "name": (m.group(1) or "").strip().rstrip(".")}
    return None


def _copilot_login() -> Optional[str]:
    home = Path(os.environ.get("COPILOT_HOME") or _home() / ".copilot")
    try:
        data = json.loads((home / "config.json").read_text(encoding="utf8"))
    except (OSError, ValueError):
        return None
    for key in ("last_logged_in_user", "lastLoggedInUser", "logged_in_users", "loggedInUsers"):
        user = data.get(key) if isinstance(data, dict) else None
        if isinstance(user, list):
            user = user[0] if user else None
        if isinstance(user, dict) and user.get("login"):
            return str(user["login"])
    return None


def _account(engine: str, exe: str) -> dict:
    """Who the tool is signed in as. Not every tool can say: then a key in the environment or a saved sign-in file
    counts as signed in, and anything else is "unknown" (the token may sit in the system credential store). The Test
    button is what settles it."""
    s = ENGINES[engine]
    if s["status"]:
        found = _from_status(engine, exe)
        if found:
            return found
    for var in s["tokens"]:
        if os.environ.get(var):
            return {"state": "signedIn", "name": f"token in {var}"}
    if engine == "copilot":
        name = _copilot_login()
        if name:
            return {"state": "signedIn", "name": name}
    for rel in s["creds"]:
        try:
            if (_home() / rel).stat().st_size > 2:
                return {"state": "signedIn", "name": ""}
        except OSError:
            pass
    return {"state": "unknown", "name": ""}


def _one(engine: str) -> dict:
    s = ENGINES[engine]
    exe = find(engine)
    out = {
        "id": engine, "label": s["label"], "by": s["by"], "provider": f"{engine}-cli", "accountKind": s["account"], "found": bool(exe),
        "version": "", "account": {"state": "unknown", "name": ""}, "install": s["install"], "url": s["url"],
        "loginCommand": login_command(engine), "models": s["models"],
    }
    if exe:
        out["version"] = _version(exe)
        out["account"] = _account(engine, exe)
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

def _still_signed_out(engine: str, exe: str) -> bool:
    """Some tools retry for minutes when nobody is signed in. If the last status said signed out, ask the tool once
    more (the user may have just signed in) and stop early when it still says so."""
    with _cache_lock:
        known = next((e for e in _cache["data"] or [] if e["id"] == engine), None)
    if not known or known["account"]["state"] != "signedOut":
        return False
    if _account(engine, exe)["state"] == "signedOut":
        return True
    forget()
    return False


def explain(engine: str, model: Optional[str], code: Optional[int], text: str) -> dict:
    """Turns what the tool printed when it failed into what broke and what to do next."""
    s = spec(engine)
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    why = [lines[0][:240]] if lines else []
    if _SIGNED_OUT.search(text):
        return problem(f"{s['label']} is not signed in", why or [f"No {s['account']} account is connected to it"],
                       f"Press Sign in on the AI engines page, or run `{login_command(engine)}` in a terminal. Then press Test.")
    if _LIMIT.search(text):
        return problem(f"{s['label']} says the account hit a limit", why, "Wait and try again, or switch to another engine.")
    if _MODEL.search(text):
        return problem(f"{s['label']} does not know the model {model or 'default'}", why, "Type another model name, or use default.")
    return problem(f"{s['label']} stopped with an error" + (f" (exit {code})" if code else ""), why or ["It printed nothing"],
                   f"Run `{s['bin']}` in a terminal to see what it needs, then try again.")


def ask(engine: str, text: str, model: Optional[str] = None, cwd: Optional[str] = None, timeout: int = TIMEOUT) -> str:
    s = spec(engine)
    args = ask_command(engine, model)
    if _still_signed_out(engine, args[0]):
        raise EngineProblem(explain(engine, model, None, "Not logged in"), 502)
    where = cwd or ask_dir()
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
