"""AI engines: command-line tools signed in on this computer. A small stand-in script plays the tool."""
import json
import os
import stat
import sys
import time

import pytest

from visualizer import agent, engines
from visualizer.hub import hub

SCRIPT = """import json, sys
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    print(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "email": "dev@example.com"}))
elif args == ["--version"]:
    print("9.9.9 (stand-in)")
elif "%(mode)s" == "signed-out":
    sys.stderr.write("Error: No authentication information found.\\n")
    sys.exit(1)
else:
    prompt = sys.stdin.read()
    print("OK args=" + json.dumps(args) + " stdin=" + json.dumps(prompt))
"""


def fake_cli(folder, name: str, mode: str = "ok") -> str:
    """A runnable stand-in for `claude` or `copilot` that echoes its arguments and what it read on standard input."""
    script = folder / f"{name}_{mode}.py"
    script.write_text(SCRIPT % {"mode": mode})
    if os.name == "nt":
        exe = folder / f"{name}_{mode}.cmd"
        exe.write_text(f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n')
    else:
        exe = folder / f"{name}_{mode}"
        exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
        exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return str(exe)


@pytest.fixture(autouse=True)
def fresh():
    engines.forget()
    yield
    engines.forget()


@pytest.fixture
def tools(tmp_path, monkeypatch):
    """Claude Code is installed and signed in; Copilot is installed but signed out."""
    found = {"claude": fake_cli(tmp_path, "claude"), "copilot": fake_cli(tmp_path, "copilot", "signed-out")}
    monkeypatch.setattr(engines, "find_exe", lambda name: found.get(name))
    monkeypatch.setattr(agent, "claude_path", lambda: found.get("claude"))
    for var in ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path / "no-copilot-home"))
    return found


def test_status_says_what_is_installed_and_who_is_signed_in(auth, tools):
    r = auth.get("/api/engines")
    assert r.status_code == 200
    claude, copilot = r.json()["engines"]
    assert claude["found"] and claude["version"] == "9.9.9 (stand-in)"
    assert claude["account"] == {"state": "signedIn", "name": "dev@example.com"}
    assert claude["loginCommand"] == "claude auth login" and claude["provider"] == "claude-cli"
    assert copilot["found"] and copilot["account"]["state"] == "unknown" and copilot["loginCommand"] == "copilot login"


def test_a_missing_engine_says_how_to_install_it(auth, monkeypatch):
    monkeypatch.setattr(engines, "find_exe", lambda name: None)
    copilot = auth.get("/api/engines?refresh=1").json()["engines"][1]
    assert not copilot["found"] and copilot["install"] == "npm install -g @github/copilot"
    providers = {p["id"]: p for p in auth.get("/api/ai/settings").json()["providers"]}
    assert providers["copilot-cli"]["cli"] and not providers["copilot-cli"]["ready"] and not providers["groq"]["cli"]
    r = auth.post("/api/ai/test", {"provider": "copilot-cli"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "GitHub Copilot CLI was not found"
    assert "npm install -g @github/copilot" in r.json()["problem"]["next"]


def test_copilot_reads_a_remembered_login_or_a_token(tools, tmp_path, monkeypatch):
    home = tmp_path / "copilot-home"
    home.mkdir()
    (home / "config.json").write_text(json.dumps({"last_logged_in_user": {"host": "https://github.com", "login": "octocat"}}))
    monkeypatch.setenv("COPILOT_HOME", str(home))
    assert engines.status(refresh=True)[1]["account"] == {"state": "signedIn", "name": "octocat"}
    monkeypatch.setenv("GH_TOKEN", "github_pat_x")
    assert engines.status(refresh=True)[1]["account"] == {"state": "signedIn", "name": "token in GH_TOKEN"}


def test_the_test_button_asks_the_signed_in_tool_and_the_prompt_goes_in_on_stdin(auth, tools):
    auth.post("/api/ai/settings", {"provider": "claude-cli", "model": "sonnet", "makeActive": True}, format="json")
    r = auth.post("/api/ai/test", {}, format="json")
    assert r.status_code == 200, r.content
    assert r.json()["provider"] == "claude-cli" and r.json()["model"] == "sonnet" and r.json()["reply"].startswith("OK")
    said = engines.ask("claude", 'Say "hi" & %PATH% | done', model="sonnet")
    args = json.loads(said.split("args=")[1].split(" stdin=")[0])
    assert args == ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence", "--model", "sonnet"]
    assert json.loads(said.split(" stdin=")[1]) == 'Say "hi" & %PATH% | done'


def test_an_engine_edits_a_file_like_any_other_provider(auth, tools, tmp_path, monkeypatch):
    project = tmp_path / "shop"
    project.mkdir()
    (project / "a.py").write_text("x = 1\n")
    monkeypatch.setattr(engines, "ask", lambda engine, text, model=None, **kw: "Set x to 2.\n```python\nx = 2\n```")
    auth.post("/api/ai/settings", {"provider": "claude-cli", "model": "default", "makeActive": True}, format="json")
    r = auth.post("/api/ai/edit", {"path": str(project), "file": "a.py", "instruction": "set x to 2"}, format="json")
    assert r.status_code == 200 and r.json()["updated"] == "x = 2\n" and r.json()["provider"] == "claude-cli" and r.json()["model"] == "default"


def test_a_signed_out_engine_says_how_to_sign_in(auth, tools):
    r = auth.post("/api/ai/test", {"provider": "copilot-cli"}, format="json")
    assert r.status_code == 502 and r.json()["error"] == "GitHub Copilot CLI is not signed in"
    assert "copilot login" in r.json()["problem"]["next"]
    assert r.json()["problem"]["why"] == ["Error: No authentication information found."]


def test_failures_are_explained():
    assert engines.explain("claude", None, 1, "Invalid API key · Please run /login")["what"] == "Claude Code is not signed in"
    assert "hit a limit" in engines.explain("claude", None, 1, "Claude usage limit reached. Resets at 5pm")["what"]
    assert engines.explain("claude", "gpt-9", 1, 'Claude Code doesn\'t recognize the model "gpt-9"')["what"] == "Claude Code does not know the model gpt-9"
    assert engines.explain("copilot", None, 3, "boom")["what"] == "GitHub Copilot CLI stopped with an error (exit 3)"


def test_sign_in_opens_the_tools_own_flow(auth, tools, monkeypatch):
    opened = []
    monkeypatch.setattr(engines, "_open_terminal", lambda cmd: opened.append(cmd) or True)
    r = auth.post("/api/engines/login", {"engine": "copilot"}, format="json")
    assert r.json() == {"engine": "copilot", "opened": True, "command": "copilot login"}
    assert opened == [[tools["copilot"], "login"]]
    monkeypatch.setattr(engines, "_open_terminal", lambda cmd: False)
    assert auth.post("/api/engines/login", {"engine": "claude"}, format="json").json() == {"engine": "claude", "opened": False, "command": "claude auth login"}
    r = auth.post("/api/engines/login", {"engine": "skynet"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "That AI engine is not supported"


def _send(auth, repo, monkeypatch, body: dict) -> str:
    lines: list = []
    monkeypatch.setattr(hub, "output", lambda payload: lines.append(payload["line"]))
    r = auth.post("/api/agent/send", {"path": str(repo), **body}, format="json")
    assert r.status_code == 202, r.content
    end = time.time() + 10
    while time.time() < end and not any(e["type"] == "turn.end" and e["ts"] >= start for e in hub.recent(5)):
        time.sleep(0.05)
    return "\n".join(lines)


start = 0


def test_the_chat_sends_the_prompt_to_claude_code_on_stdin(auth, tools, tmp_path, monkeypatch):
    global start
    start = int(time.time() * 1000)
    out = _send(auth, tmp_path, monkeypatch, {"prompt": 'Add a "coupon" field', "model": "sonnet"})
    assert json.loads(out.split("args=")[1].split(" stdin=")[0]) == ["-p", "--model", "sonnet", "--permission-mode", "acceptEdits"]
    assert json.loads(out.split(" stdin=")[1]) == 'Add a "coupon" field'
    assert hub.recent(1)[0]["message"] == "Claude Code finished (exit 0)"


def test_the_chat_can_send_to_copilot_which_may_write_files_but_not_run_commands(auth, tools, tmp_path, monkeypatch):
    global start
    start = int(time.time() * 1000)
    tools["copilot"] = fake_cli(tmp_path, "copilot")
    out = _send(auth, tmp_path, monkeypatch, {"prompt": "Add coupon", "engine": "copilot"})
    args = json.loads(out.split("args=")[1].split(" stdin=")[0])
    assert args == ["-s", "--no-color", "--no-ask-user", "--allow-tool=write"]
    assert not any("allow-all" in a for a in args)
    assert hub.recent(1)[0]["message"] == "GitHub Copilot CLI finished (exit 0)"


def test_a_failed_chat_run_says_what_to_do(auth, tools, tmp_path, monkeypatch):
    global start
    start = int(time.time() * 1000)
    out = _send(auth, tmp_path, monkeypatch, {"prompt": "Add coupon", "engine": "copilot"})
    assert "GitHub Copilot CLI is not signed in. Press Sign in" in out


def test_an_unknown_or_missing_engine_is_refused(auth, tools, tmp_path):
    r = auth.post("/api/agent/send", {"path": str(tmp_path), "prompt": "x", "engine": "skynet"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "That AI engine is not supported"
    tools.pop("copilot")
    r = auth.post("/api/agent/send", {"path": str(tmp_path), "prompt": "x", "engine": "copilot"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "GitHub Copilot CLI was not found"
