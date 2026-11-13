"""The development team: a Lead that is always on, and six specialists it calls only when a request needs them.

    Lead -> picks the smallest team -> you agree -> each picked agent works in turn -> a summary

Each agent is its own Claude Code run with its own instructions and its own tool list, so what it may do is decided
here, when it is started, not by what it is asked to do. On top of that, Codeville takes a picture of the project before
each agent works and puts back any file the agent was not allowed to change. The agents never run a shell: the Tester
and Deployment can only run the project's own test and build commands, through the Codeville tools.

Each agent's last reply is its handoff note. Codeville saves the notes in `.codeville/team/<run>/` inside the project,
and passes them to the agents that come after.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from . import agent, engines, gitops
from .analysis.knowledge import EXTENSIONS, IGNORE_DIRS
from .config import config_dir
from .events import new_id, problem
from .hub import EventHub

# ---------------------------------------------------------------------------------------------- the roles

READ = ["Read", "Glob", "Grep"]
EDIT = ["Edit", "Write", "NotebookEdit"]
# The Codeville tools that only read the project.
LOOK = ["project_map", "find_features", "find_connections", "find_commands", "find_tests", "current_problems", "git_status", "recent_events"]

ROLES: dict = {
    "lead": {
        "label": "Team lead", "color": "#8a93b8", "writes": "none", "tools": READ, "mcp": LOOK,
        "job": "Always on. Decides which specialists your request needs and calls only them.",
        "may": "Read the project. Never edits files.",
    },
    "architect": {
        "label": "Architect", "color": "#a892ff", "writes": "none", "tools": READ, "mcp": LOOK,
        "job": "Decides the approach: which files change, what data is added, what could break.",
        "may": "Read the project. Never edits files.",
    },
    "ux": {
        "label": "UI and UX designer", "color": "#ff7cc8", "writes": "none", "tools": READ, "mcp": LOOK,
        "job": "Describes each screen and its states, the wording, keyboard use and contrast.",
        "may": "Read the project. Never edits files.",
    },
    "developer": {
        "label": "Developer", "color": "#ff9f43", "writes": "code", "tools": READ + EDIT, "mcp": LOOK,
        "job": "Writes the code, following the design and the screen spec.",
        "may": "Read and edit project files. Not .env files, not .git. Never runs commands.",
    },
    "tester": {
        "label": "Tester", "color": "#5be37a", "writes": "tests", "tools": READ + EDIT, "mcp": LOOK + ["run_check"],
        "job": "Writes tests for the new behaviour, runs the project's tests, reports what failed.",
        "may": "Edit test files only. Run the project's own test, lint and type-check commands.",
    },
    "security": {
        "label": "Security reviewer", "color": "#ff6b78", "writes": "none", "tools": READ, "mcp": LOOK,
        "job": "Reviews the change for leaked secrets, missing input checks, weak access rules and risky packages.",
        "may": "Read the project. Never edits files.",
    },
    "deployment": {
        "label": "Deployment", "color": "#19e6ff", "writes": "build", "tools": READ + EDIT, "mcp": LOOK + ["run_check"],
        "job": "Runs the build, checks settings are documented, writes release notes. You push.",
        "may": "Edit build and CI files. Run the project's own build command. Never pushes.",
    },
}
SPECIALISTS = ["architect", "ux", "developer", "tester", "security", "deployment"]

DONE_LINE = (
    'On the very last line, write one JSON object and nothing after it: {"status": "done" or "fail", "needs": [], '
    '"severity": "none"}. Leave "needs" empty unless you could not finish without a decision only another specialist '
    'can make; the Lead already chose who works, and testing and releases are not yours to ask for.'
)
# Who may ask the Lead for help, and from whom. Help is for a decision the agent cannot make itself, so it can only go
# to the Architect or the designer; the Tester, Security and Deployment are the Lead's call (and Security the rules').
HELP = {"developer": {"architect", "ux"}, "ux": {"architect"}, "tester": {"architect"}}

INSTRUCTIONS: dict = {
    "lead": """You are the Team lead of a small software team working on the project in this folder. You never change files.
Read the request, look at the project (use the Codeville project_map tool, then read files as needed), and choose the SMALLEST team that can do the job well. Most requests need one or two specialists. Never call someone with nothing to do.

The specialists, and when to call each:
- architect: the change adds data, spans more than one feature, adds a new part such as a service or a package, or the request asks how something works.
- ux: something people see changes: a screen, a form, wording.
- developer: any code must change.
- tester: behaviour changes, or tests are already failing.
- security: the change touches sign-in, payments, user input, uploaded files, secrets or new packages, or the request asks about safety.
- deployment: only when the request asks for a release, a build or a deploy.

Order: architect, ux, developer, tester, security, deployment. When tests are already failing, start with tester, then developer, then tester.

Reply with ONLY one JSON object, no other text:
{"steps": [{"role": "developer", "why": "one short line"}], "tasks": ["short task"], "summary": "one sentence saying what will be done"}""",
    "architect": """You are the Architect. You never change files. Read the code that matters to the request and write a short design:
1. The approach in two or three sentences.
2. Files to change or add, one line each saying why.
3. New data or settings, if any.
4. What could break, and how the Tester can check it.
Keep it short enough to read in a minute. If the request only asks how something works, explain that instead.
""" + DONE_LINE,
    "ux": """You are the UI and UX designer. You never change files. Read the project's existing screens and styles first, and stay consistent with them. For each screen the request touches, write:
- what the person sees and does, step by step
- the empty, loading and error states, with the exact wording
- keyboard use and readable contrast
Plain words, short lists.
""" + DONE_LINE,
    "developer": """You are the Developer. Implement the request in the project's own style, following the Architect's design and the designer's spec when there are any. Change only what the request needs. Do not edit .env files. You cannot run commands; the Tester runs the tests after you.
When you finish, write a handoff note: what you changed, file by file, and anything the Tester should check.
If you find the work needs a design decision you cannot make, stop and put "architect" in "needs".
""" + DONE_LINE,
    "tester": """You are the Tester. Write or update tests for the behaviour in the request, in the project's existing test style. You may only edit test files. Run the project's tests with the Codeville run_check tool (kind "test"; also "lint" or "typecheck" when the project has them). Do not try to fix application code.
Write a handoff note: which tests you added, what you ran, and for every failure the file, the line and what broke.
Use "status": "fail" when any test fails, so the Developer is called back.
""" + DONE_LINE,
    "security": """You are the Security reviewer. You never change files. Review the change described in the handoff notes (use the Codeville git_status tool and read the changed files). Look for: secrets in code, missing input checks, injection, weak access rules, unsafe file handling, risky new packages.
List each finding as: severity (low, medium, high), file and line, what is wrong, how to fix it. Say plainly when you found nothing.
Set "severity" to the highest severity you found, or "none".
""" + DONE_LINE,
    "deployment": """You are Deployment. Run the project's build with the Codeville run_check tool (kind "build"), if the project has one. Check that new settings and environment variables are documented (for example in .env.example or the README). You may only edit build and CI files and their docs. You never push or deploy; the person does that.
Write release notes: what changed for users, any new settings, and how to roll back.
""" + DONE_LINE,
}

# ---------------------------------------------------------------------------------------------- what each may change

_TEST = re.compile(r"(^|/)(tests?|__tests__|spec|e2e|cypress)/|(^|/)(test_[^/]+|[^/]+_test\.[a-z]+|[^/]+\.(test|spec)\.[a-z]+|conftest\.py)$", re.I)
_BUILD = re.compile(
    r"^(\.github/|\.gitlab-ci|\.circleci/|Dockerfile|[^/]*\.dockerfile$|docker-compose|\.dockerignore$|Procfile$|vercel\.json$|netlify\.toml$|"
    r"fly\.toml$|render\.ya?ml$|app\.ya?ml$|\.env\.example$|CHANGELOG|README|RELEASE|DEPLOY)", re.I)
_SECRET = re.compile(r"(^|/)\.env($|\.(?!example$)[^/]*$)", re.I)


def may_write(role: str, path: str) -> bool:
    """Whether this role may change this project file (a path relative to the project, with forward slashes)."""
    if path.startswith((".git/", ".codeville/")):
        return False
    kind = ROLES[role]["writes"]
    if kind == "code":
        return not _SECRET.search(path)
    if kind == "tests":
        return bool(_TEST.search(path))
    if kind == "build":
        return bool(_BUILD.search(path)) and not _SECRET.search(path)
    return False


# ---------------------------------------------------------------------------------------------- what needs Security

_SENSITIVE_WORDS = {
    "auth", "authentication", "authorization", "login", "logout", "signin", "signup", "session", "sessions", "password",
    "passwords", "token", "tokens", "jwt", "oauth", "secret", "secrets", "credential", "credentials", "permission",
    "permissions", "admin", "payment", "payments", "pay", "billing", "checkout", "stripe", "paypal", "invoice", "upload",
    "uploads", "crypto", "encrypt", "encryption", "apikey", "cookie", "cookies", "csrf", "cors",
}
_MANIFESTS = {"package.json", "requirements.txt", "pyproject.toml", "pipfile", "go.mod", "cargo.toml", "gemfile", "composer.json", "pom.xml", "build.gradle"}


def _words(text: str) -> set:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = re.sub(r"\b(sign|log)[ -](in|up|out)\b", r"\1\2", text, flags=re.I)
    text = re.sub(r"\bapi[ -_]?key", "apikey", text, flags=re.I)
    return {w for w in re.split(r"[^a-z0-9]+", text.lower()) if w}


def sensitive_request(text: str) -> list:
    """The words in a request that mean Security must look at the change."""
    return sorted(_words(text) & _SENSITIVE_WORDS)


def sensitive_paths(paths: list) -> list:
    """The changed files that mean Security must look at the change: sign-in, payments, secrets, packages and so on."""
    out = []
    for p in paths:
        name = p.rsplit("/", 1)[-1].lower()
        if name in _MANIFESTS or _SECRET.search(p) or _words(p) & _SENSITIVE_WORDS:
            out.append(p)
    return out


# ---------------------------------------------------------------------------------------------- the project picture

MAX_SNAPSHOT_FILES = 20_000
MAX_KEEP_BYTES = 2_000_000


def snapshot(root: Path) -> dict:
    """Every project file: its bytes (to put it back) or, for a big file, its size and time (to see that it changed)."""
    out: dict = {}

    def walk(d: Path) -> None:
        try:
            entries = list(os.scandir(d))
        except OSError:
            return
        for e in entries:
            if len(out) >= MAX_SNAPSHOT_FILES:
                return
            try:
                if e.is_dir(follow_symlinks=False):
                    if e.name in IGNORE_DIRS or e.name in (".git", ".codeville"):
                        continue
                    walk(Path(e.path))
                elif e.is_file(follow_symlinks=False):
                    rel = Path(e.path).relative_to(root).as_posix()
                    st = e.stat()
                    out[rel] = Path(e.path).read_bytes() if st.st_size <= MAX_KEEP_BYTES else (st.st_size, st.st_mtime_ns)
            except OSError:
                continue

    walk(root)
    return out


def changed_files(before: dict, after: dict) -> list:
    return sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p))


def put_back(root: Path, before: dict, paths: list) -> list:
    """Restores files to how they were before the agent worked. Returns the paths it restored or removed."""
    done = []
    for p in paths:
        target = root / p
        try:
            if p not in before:
                target.unlink(missing_ok=True)
            elif isinstance(before[p], bytes):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(before[p])
            else:
                continue  # too big to have kept a copy; reported, not restored
            done.append(p)
        except OSError:
            continue
    return done


def _source_like(path: str) -> bool:
    name = path.rsplit("/", 1)[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return ext in EXTENSIONS or name.startswith(".env") or bool(_BUILD.search(path))


# ---------------------------------------------------------------------------------------------- settings

def settings_path() -> Path:
    return Path(config_dir()) / "team.json"


def load_settings() -> dict:
    try:
        raw = json.loads(settings_path().read_text(encoding="utf8"))
    except (OSError, ValueError):
        raw = {}
    roles = raw.get("roles") if isinstance(raw.get("roles"), dict) else {}
    out = {"approveDesign": raw.get("approveDesign", True) is not False, "roles": {}}
    for r in ROLES:
        mine = roles.get(r) if isinstance(roles.get(r), dict) else {}
        out["roles"][r] = {
            "enabled": r == "lead" or mine.get("enabled", True) is not False,
            "model": str(mine.get("model") or "")[:80],
            "extra": str(mine.get("extra") or "")[:4000],
        }
    return out


def save_settings(change: dict) -> dict:
    s = load_settings()
    if "approveDesign" in change:
        s["approveDesign"] = bool(change["approveDesign"])
    for r, v in (change.get("roles") or {}).items():
        if r not in ROLES or not isinstance(v, dict):
            continue
        if "enabled" in v and r != "lead":
            s["roles"][r]["enabled"] = bool(v["enabled"])
        if "model" in v:
            s["roles"][r]["model"] = str(v["model"] or "").strip()[:80]
        if "extra" in v:
            s["roles"][r]["extra"] = str(v["extra"] or "")[:4000]
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(s, indent=2), encoding="utf8")
    return s


def describe() -> dict:
    """The roles as the Team page shows them, with this computer's settings."""
    s = load_settings()
    roles = []
    for r, meta in ROLES.items():
        roles.append({"id": r, "label": meta["label"], "color": meta["color"], "job": meta["job"], "may": meta["may"],
                      "instructions": INSTRUCTIONS[r], **s["roles"][r]})
    return {"roles": roles, "approveDesign": s["approveDesign"], "engine": "claude"}


# ---------------------------------------------------------------------------------------------- one run

class TeamProblem(Exception):
    def __init__(self, p: dict, status: int = 400):
        super().__init__(p["what"])
        self.problem = p
        self.status = status


@dataclass
class Stage:
    role: str
    why: str = ""
    status: str = "waiting"  # waiting, working, done, failed, stopped
    note: str = ""
    file: str = ""
    changed: list = field(default_factory=list)
    putBack: list = field(default_factory=list)
    result: dict = field(default_factory=dict)
    outputId: str = ""
    added: str = ""  # why it was added during the run, when it was


@dataclass
class Run:
    id: str
    root: str
    request: str
    state: str = "picking"  # picking, pick, running, design, security, done, stopped, failed
    pick: list = field(default_factory=list)
    tasks: list = field(default_factory=list)
    plan: str = ""
    stages: list = field(default_factory=list)
    lead: Optional[Stage] = None
    changed: list = field(default_factory=list)
    summary: str = ""
    problem: Optional[dict] = None
    commit: Optional[dict] = None
    notes: str = ""
    started: int = field(default_factory=lambda: int(time.time() * 1000))
    gate: threading.Event = field(default_factory=threading.Event, repr=False)
    answer: dict = field(default_factory=dict, repr=False)
    stop: bool = False
    proc: Optional[subprocess.Popen] = field(default=None, repr=False)

    def public(self) -> dict:
        def st(s: Stage) -> dict:
            return {"role": s.role, "label": ROLES[s.role]["label"], "color": ROLES[s.role]["color"], "why": s.why, "status": s.status,
                    "note": s.note, "file": s.file, "changed": s.changed, "putBack": s.putBack, "result": s.result,
                    "outputId": s.outputId, "added": s.added}
        return {
            "id": self.id, "root": self.root, "request": self.request, "state": self.state, "pick": self.pick,
            "tasks": self.tasks, "plan": self.plan, "stages": [st(s) for s in self.stages], "lead": st(self.lead) if self.lead else None,
            "changed": self.changed, "summary": self.summary, "problem": self.problem, "commit": self.commit, "notes": self.notes,
            "started": self.started,
        }


_lock = threading.Lock()
_current: dict = {"run": None}
MAX_STAGES = 14
MAX_FIX_ROUNDS = 2


def current() -> Optional[Run]:
    return _current["run"]


def _busy() -> bool:
    run = current()
    return bool(run and run.state not in ("done", "stopped", "failed"))


# The way a stage is started. Tests replace it with a stand-in so no real agent runs.
def _claude_stage(role: str, prompt: str, root: str, hub: EventHub, emit: Callable[[str, str], None], model: str,
                  on_proc: Callable[[subprocess.Popen], None]) -> tuple:
    """Runs one agent with its own tool list. Returns (reply text, failed)."""
    exe = agent.claude_path()
    if not exe:
        raise TeamProblem(problem("Claude Code was not found", ["The team runs on Claude Code"], "Install Claude Code and sign in, then try again."))
    meta = ROLES[role]
    allowed = [f"mcp__{srv}__{t}" for srv in (agent.MCP_NAME, f"plugin_code-visualizer_{agent.MCP_NAME}") for t in meta["mcp"]]
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence",
            "--tools", ",".join(meta["tools"]), "--allowedTools", ",".join(allowed)]
    cfg = agent.mcp_config()
    if cfg:
        args += ["--mcp-config", cfg]
    if meta["writes"] != "none":
        args += ["--permission-mode", "acceptEdits"]
    if model:
        args += ["--model", model]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    proc = subprocess.Popen(args, cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace", creationflags=flags, env=engines.child_env(quiet=True))
    on_proc(proc)
    # Claude Code's stream names its session, and the chat remembers that name to continue its conversation. A team
    # agent's session is not the chat's, so the chat's is put back afterwards.
    chat_session = agent.session_for(root)
    turn = _TeamTurn(prompt, root, hub, emit, role)

    def feed() -> None:
        try:
            proc.stdin.write(prompt)
            proc.stdin.close()
        except (OSError, ValueError):
            pass

    def pump(stream, name: str) -> None:
        for line in iter(stream.readline, ""):
            turn.line(line, name)
        stream.close()

    threads = [threading.Thread(target=feed, daemon=True), threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True),
               threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True)]
    for t in threads:
        t.start()
    proc.wait()
    for t in threads:
        t.join(timeout=2)
    if not turn.done:
        turn.finish(turn.failed or ("Stopped." if proc.returncode else ""), failed=bool(turn.failed) or bool(proc.returncode))
    with agent._lock:
        if chat_session:
            agent._sessions[agent._key(root)] = chat_session
        else:
            agent._sessions.pop(agent._key(root), None)
    return turn.text, turn.failed_run


class _TeamTurn(agent.Turn):
    """Claude Code's stream for one agent of the team. File changes and tools still reach the town, tagged with the
    role; the chat's own session events are left out, so a team run does not appear as a chat conversation."""

    def __init__(self, prompt: str, cwd: str, hub: EventHub, emit: Callable[[str, str], None], role: str):
        super().__init__(prompt, cwd, hub, emit, hooked=False, resumed=True)
        self.role = role
        self.text = ""
        self.failed_run = False

    def _push(self, event: dict) -> None:
        if event.get("type") in ("session.start", "prompt", "turn.end"):
            return
        self.hub.push({**event, "team": self.role})

    def finish(self, text: str, failed: bool = False) -> None:
        if self.done:
            return
        self.done = True
        self.text, self.failed_run = text or "", failed
        if failed and text:
            self.emit(text, "err")


run_stage = _claude_stage


def _json_object(text: str) -> Optional[dict]:
    """The last JSON object in a reply: a fenced block, or a {...} on its own."""
    for block in reversed(re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)):
        try:
            v = json.loads(block)
            if isinstance(v, dict):
                return v
        except ValueError:
            pass
    found = []  # (end, start, object): the outermost object that ends last wins, not one nested inside it
    for m in re.finditer(r"\{", text):
        try:
            v, end = json.JSONDecoder().raw_decode(text[m.start():])
        except ValueError:
            continue
        if isinstance(v, dict):
            found.append((m.start() + end, -m.start(), v))
    return max(found, key=lambda x: (x[0], x[1]))[2] if found else None


def _split_result(text: str) -> tuple:
    """(handoff note, result) from an agent's reply. The result is the JSON on the last line."""
    lines = text.rstrip().splitlines()
    result: dict = {}
    if lines:
        try:
            v = json.loads(lines[-1].strip().strip("`"))
            if isinstance(v, dict):
                result, lines = v, lines[:-1]
        except ValueError:
            pass
    status = result.get("status") if result.get("status") in ("done", "fail") else "done"
    needs = [n for n in result.get("needs") or [] if n in SPECIALISTS] if isinstance(result.get("needs"), list) else []
    severity = result.get("severity") if result.get("severity") in ("none", "low", "medium", "high") else "none"
    return "\n".join(lines).strip().strip("`").strip(), {"status": status, "needs": needs, "severity": severity}


class Team:
    """Runs one request through the team. One run at a time."""

    def __init__(self, hub: EventHub):
        self.hub = hub

    # ---- the outside world

    def start(self, root: str, request: str) -> Run:
        request = request.strip()
        if not request:
            raise TeamProblem(problem("Tell the team what to do", ["The request is empty"], "Describe the feature or the fix."))
        with _lock:
            if _busy():
                raise TeamProblem(problem("The team is already working", ["One run at a time"], "Wait for it to finish, or press Stop."), 409)
            run = Run(id=new_id("team"), root=str(Path(root).resolve()), request=request)
            run.notes = f".codeville/team/{run.id}"
            _current["run"] = run
        threading.Thread(target=self._main, args=(run,), daemon=True).start()
        self._tell(run)
        return run

    def answer(self, run_id: str, gate: str, **answer) -> Run:
        run = current()
        if not run or run.id != run_id:
            raise TeamProblem(problem("That team run is over", [f"No run {run_id}"], "Start a new one."), 404)
        if run.state != gate:
            raise TeamProblem(problem("The team is not waiting for that", [f"It is {run.state}"], "Look at the run again."), 409)
        run.answer = answer
        run.gate.set()
        return run

    def stop(self, run_id: str) -> Run:
        run = current()
        if not run or run.id != run_id:
            raise TeamProblem(problem("That team run is over", [f"No run {run_id}"], "Start a new one."), 404)
        run.stop = True
        run.gate.set()
        if run.proc and run.proc.poll() is None:
            run.proc.kill()
        return run

    # ---- inside

    def _tell(self, run: Run) -> None:
        self.hub.push({"type": "team.run", "source": "app", "run": run.public()})

    def _wait(self, run: Run, gate: str) -> dict:
        run.state = gate
        run.gate.clear()
        self._tell(run)
        run.gate.wait()
        run.gate.clear()
        if run.stop:
            return {}
        run.state = "running"
        return run.answer

    def _save(self, run: Run, name: str, text: str) -> str:
        rel = f"{run.notes}/{name}"
        target = Path(run.root) / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        keep_out = target.parent.parent / ".gitignore"  # the notes are for reading here, not for the repository
        if not keep_out.exists():
            keep_out.write_text("*\n", encoding="utf8")
        target.write_text(text, encoding="utf8")
        return rel

    def _prompt(self, run: Run, stage: Stage, extra: str) -> str:
        s = load_settings()
        parts = [INSTRUCTIONS[stage.role]]
        if s["roles"][stage.role]["extra"].strip():
            parts.append("Extra instructions from the person:\n" + s["roles"][stage.role]["extra"].strip())
        parts.append(f"The request:\n{run.request}")
        if run.plan or run.tasks:
            parts.append("The Lead's plan:\n" + run.plan + "".join(f"\n- {t}" for t in run.tasks))
        done = [x for x in run.stages if x.status == "done" and x.note]
        if done:
            parts.append("Handoff notes so far, oldest first:\n\n" + "\n\n".join(f"## {ROLES[x.role]['label']}\n{x.note[-6000:]}" for x in done))
        if stage.why:
            parts.append(f"Why you were called: {stage.why}")
        if extra:
            parts.append(extra)
        return "\n\n".join(parts)

    def _work(self, run: Run, stage: Stage, extra: str = "") -> None:
        """One agent's turn: run it, put back what it may not change, save its note."""
        root = Path(run.root)
        stage.status, stage.outputId = "working", new_id("tout")
        self._tell(run)
        before = snapshot(root)
        began = int(time.time() * 1000)
        model = load_settings()["roles"][stage.role]["model"]

        def on_proc(proc: subprocess.Popen) -> None:
            run.proc = proc

        emit = lambda line, stream: self.hub.output({"runId": stage.outputId, "line": line, "stream": stream})  # noqa: E731
        try:
            text, failed = run_stage(stage.role, self._prompt(run, stage, extra), run.root, self.hub, emit, model, on_proc)
        except TeamProblem as err:
            text, failed = f"{err.problem['what']}. {err.problem['next']}", True
        except OSError as err:
            text, failed = f"Claude Code could not be started: {err}", True
        run.proc = None
        changed = changed_files(before, snapshot(root))
        refused = [p for p in changed if not may_write(stage.role, p) and (p in before or _source_like(p))]
        stage.putBack = put_back(root, before, refused)
        stage.changed = [p for p in changed if p not in refused]
        for p in stage.changed:
            if p not in run.changed:
                run.changed.append(p)
        for p in stage.putBack:
            self.hub.push({"type": "file.change", "source": "app", "path": p, "op": "edit", "team": stage.role})
        if stage.role == "lead":
            stage.note, stage.result = text.strip(), {}
        else:
            stage.note, stage.result = _split_result(text)
        # A check that could not even start is not a pass, whatever the agent says: say so where nobody can miss it.
        blocked = [e for e in self.hub.recent(1000) if e.get("type") == "run.end" and e.get("ts", 0) >= began and e.get("status") == "fail"
                   and (e.get("problem") or {}).get("what") in ("The tests did not run", "The build failed")]
        if blocked:
            stage.result["didNotRun"] = sorted({f"{e['kind']}: {((e['problem'].get('why') or [''])[0])[:160]}" for e in blocked})
        if stage.putBack:
            stage.note += "\n\nCodeville put back " + ", ".join(stage.putBack) + f": the {ROLES[stage.role]['label']} may not change them."
        stage.status = "stopped" if run.stop else "failed" if failed else "done"
        n = len([x for x in run.stages if x.status != "waiting"]) if stage.role != "lead" else 0
        stage.file = self._save(run, f"{n:02d}-{stage.role}.md", f"# {ROLES[stage.role]['label']}\n\n{stage.note}\n")
        self._tell(run)

    def _pick(self, run: Run, lead: Stage) -> Optional[list]:
        """The Lead's choice, checked: known roles, switched-on roles, a sane order, and Security when it is needed."""
        data = _json_object(lead.note) or {}
        steps = data.get("steps") if isinstance(data.get("steps"), list) else []
        enabled = load_settings()["roles"]
        out: list = []
        for st in steps:
            role = st.get("role") if isinstance(st, dict) else None
            if role in SPECIALISTS and enabled[role]["enabled"] and sum(1 for x in out if x["role"] == role) < 2:
                out.append({"role": role, "why": str(st.get("why") or "")[:200], "locked": False})
        if not out:
            return None
        run.tasks = [str(t)[:200] for t in data.get("tasks") or [] if isinstance(t, str)][:10]
        run.plan = str(data.get("summary") or "")[:400]
        words = sensitive_request(run.request)
        if words and any(x["role"] in ("developer", "tester", "deployment") for x in out):
            sec = next((x for x in out if x["role"] == "security"), None)
            reason = f"The request mentions {', '.join(words[:3])}. Security always reviews such changes."
            if sec:
                sec.update(locked=True, why=sec["why"] or reason)
            else:
                out.append({"role": "security", "why": reason, "locked": True})
        return _ordered(out)

    def _main(self, run: Run) -> None:
        try:
            self._flow(run)
        except Exception as err:  # noqa: BLE001 - a run must always end in a state the window can show
            run.state, run.problem = "failed", problem("The team stopped with an error", [str(err)], "Try again. If it keeps happening, report it.")
        if run.stop and run.state not in ("failed",):
            run.state = "stopped"
            for s in run.stages:
                if s.status in ("waiting", "working"):
                    s.status = "stopped"
        run.summary = self._summary(run)
        try:
            self._save(run, "summary.md", run.summary)
            self._save(run, "run.json", json.dumps(run.public(), indent=2))
        except OSError:
            pass
        self._tell(run)

    def _flow(self, run: Run) -> None:
        run.lead = Stage("lead", why="Picks the team")
        self._work(run, run.lead, extra="")
        if run.stop:
            return
        if run.lead.status != "done":
            run.state, run.problem = "failed", problem("The Lead could not start", [run.lead.note[:300] or "No answer"], "Check that Claude Code is signed in on the AI engines page, then try again.")
            return
        picked = self._pick(run, run.lead)
        if not picked:
            run.state, run.problem = "failed", problem("The Lead did not pick a team", [run.lead.note[:300] or "No answer"], "Say more about what you want, then try again.")
            return
        run.pick = picked
        answer = self._wait(run, "pick")
        if run.stop:
            return
        chosen = answer.get("roles")
        if isinstance(chosen, list):
            run.pick = _apply_choice(run.pick, chosen)
        if not run.pick:
            run.stop = True
            return
        run.stages = [Stage(p["role"], why=p["why"]) for p in run.pick]
        self._tell(run)

        settings = load_settings()
        rounds, helped, i = 0, set(), 0
        while i < len(run.stages) and not run.stop:
            stage = run.stages[i]
            extra = ""
            if stage.role == "developer" and i > 0 and run.stages[i - 1].role == "tester" and run.stages[i - 1].result.get("status") == "fail":
                extra = "The Tester found failures. Fix the application code so the tests pass. Do not weaken the tests."
            self._work(run, stage, extra)
            if run.stop:
                break
            if stage.status == "failed":
                run.state, run.problem = "failed", problem(f"The {ROLES[stage.role]['label']} could not finish", [stage.note.splitlines()[0][:300] if stage.note else "No answer"], "Check that Claude Code is signed in, then try again.")
                return
            later = [s.role for s in run.stages[i + 1:]]
            if stage.role == "architect" and settings["approveDesign"] and any(r in later for r in ("developer", "ux")):
                if not self._wait(run, "design").get("approve"):
                    run.stop = True
                    break
            if stage.role == "developer":
                risky = sensitive_paths(stage.changed)
                if risky and "security" not in later:
                    at = later.index("deployment") + i + 1 if "deployment" in later else len(run.stages)
                    run.stages.insert(at, Stage("security", why="The change touches " + ", ".join(risky[:3]), added="The Lead added Security after the code was written."))
            if stage.role == "tester" and stage.result.get("status") == "fail" and rounds < MAX_FIX_ROUNDS and any(s.role == "developer" for s in run.stages) and len(run.stages) < MAX_STAGES:
                rounds += 1
                run.stages[i + 1:i + 1] = [Stage("developer", why="Fix what the Tester found", added=f"Fix round {rounds} of {MAX_FIX_ROUNDS}"),
                                           Stage("tester", why="Check the fix", added=f"Fix round {rounds} of {MAX_FIX_ROUNDS}")]
            for need in stage.result.get("needs") or []:
                if need not in HELP.get(stage.role, set()) or need in later or (need, stage.role) in helped or len(run.stages) >= MAX_STAGES - 1:
                    continue
                helped.add((need, stage.role))
                run.stages[i + 1:i + 1] = [Stage(need, why=f"The {ROLES[stage.role]['label']} asked for help", added=f"Asked for by the {ROLES[stage.role]['label']}"),
                                           Stage(stage.role, why="Carry on with the help", added=f"Back to the {ROLES[stage.role]['label']}")]
            if stage.role == "security" and stage.result.get("severity") == "high":
                if not self._wait(run, "security").get("proceed"):
                    run.stop = True
                    break
            self._tell(run)
            i += 1
        if run.stop:
            return
        if any(s.role == "deployment" and s.status == "done" for s in run.stages):
            run.commit = self._commit(run)
        run.state = "done"

    def _commit(self, run: Run) -> Optional[dict]:
        """Deployment prepares and commits; the person pushes. Only the files the team changed are committed."""
        files = list(run.changed)
        if not files:
            return None
        try:
            gitops.stage(run.root, files, True)
            first = run.request.strip().splitlines()[0][:68]
            return gitops.commit(run.root, f"{first}\n\n{run.plan or 'Made by the Codeville team.'}\n\nMade by the Codeville team, run {run.id}.")
        except gitops.GitProblem as err:
            return {"error": err.problem["what"], "next": err.problem["next"]}

    def _summary(self, run: Run) -> str:
        lines = [f"# Team run {run.id}", "", f"**Request:** {run.request}", "", f"**Result:** {run.state}"]
        if run.plan:
            lines += ["", f"**Plan:** {run.plan}"]
        if run.problem:
            lines += ["", f"**Problem:** {run.problem['what']}. {run.problem['next']}"]
        if run.stages:
            lines += ["", "## Who worked"]
            for s in run.stages:
                first = next((l.strip("# ").strip() for l in s.note.splitlines() if l.strip()), "")
                lines.append(f"- {ROLES[s.role]['label']}: {s.status}" + (f". {first[:160]}" if first else "") + (f" ({s.added})" if s.added else ""))
        stuck = sorted({w for s in run.stages for w in s.result.get("didNotRun", [])})
        if stuck:
            lines += ["", "## Checks that could not run", *[f"- {w}" for w in stuck],
                      "", "Install the project's packages, then ask the team to test again. The team cannot install packages."]
        if run.changed:
            lines += ["", "## Files changed", *[f"- {p}" for p in run.changed]]
        if run.commit and run.commit.get("hash"):
            lines += ["", f"Committed as {run.commit['hash']} on {run.commit['branch']}. Push it from Source control when you are ready."]
        elif run.commit:
            lines += ["", f"Not committed: {run.commit.get('error')}. {run.commit.get('next')}"]
        return "\n".join(lines) + "\n"


def _ordered(pick: list) -> list:
    """Keeps the Lead's order, except: Security comes after the last Developer, and Deployment comes last."""
    rest = [p for p in pick if p["role"] not in ("security", "deployment")]
    return rest + [p for p in pick if p["role"] == "security"][:1] + [p for p in pick if p["role"] == "deployment"][:1]


def _apply_choice(pick: list, roles: list) -> list:
    """The person's changes to the pick. A locked Security cannot be removed; added roles take their usual place."""
    wanted = [r for r in roles if r in SPECIALISTS]
    kept = [p for p in pick if p["role"] in wanted or p.get("locked")]
    have = {p["role"] for p in kept}
    for r in SPECIALISTS:
        if r in wanted and r not in have:
            at = next((k for k, p in enumerate(kept) if SPECIALISTS.index(p["role"]) > SPECIALISTS.index(r)), len(kept))
            kept.insert(at, {"role": r, "why": "Added by you", "locked": False})
            have.add(r)
    return _ordered(kept)
