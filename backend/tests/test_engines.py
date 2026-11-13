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
    listed = r.json()["engines"]
    assert [e["id"] for e in listed] == ["claude", "copilot", "codex", "gemini", "opencode", "qwen", "amp"]
    claude, copilot, codex = listed[:3]
    assert not codex["found"] and codex["install"] == "npm install -g @openai/codex" and codex["loginCommand"] == "codex login"
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


def test_every_engine_has_a_safe_command_line():
    for eid, e in engines.ENGINES.items():
        ask = engines.ask_command(eid, "m1", exe="x")
        chat = engines.agent_command(eid, "m1", True, exe="x")
        locked = engines.agent_command(eid, None, False, exe="x")
        for args in (ask, chat, locked):
            assert not any(w in a.lower() for a in args for w in ("yolo", "allow-all", "dangerously", "bypass", "danger-full")), (eid, args)
        assert ("m1" in ask) == bool(e["model"]) and "m1" not in locked
    assert engines.ask_command("codex", None, exe="x") == ["x", "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never"]
    assert engines.agent_command("codex", "gpt-5", True, exe="x")[-4:] == ["--model", "gpt-5", "--sandbox", "workspace-write"]
    assert engines.agent_command("gemini", None, True, exe="x") == ["x", "--skip-trust", "-o", "text", "--approval-mode", "auto_edit"]
    assert engines.agent_command("gemini", None, False, exe="x")[-2:] == ["--approval-mode", "plan"]
    assert engines.agent_command("opencode", None, False, exe="x") == ["x", "run", "--agent", "plan"]
    assert engines.agent_command("qwen", None, True, exe="x") == ["x", "--approval-mode", "auto-edit"]
    assert engines.agent_command("amp", "ignored", True, exe="x") == ["x", "-x", "--no-color"]


def test_sign_in_is_read_from_the_tool_a_key_or_a_saved_file(tools, tmp_path, monkeypatch):
    monkeypatch.setattr(engines, "_home", lambda: tmp_path)
    for var in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "AMP_API_KEY", "DASHSCOPE_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    assert engines._account("gemini", "x") == {"state": "unknown", "name": ""}
    (tmp_path / ".gemini").mkdir()
    (tmp_path / ".gemini" / "oauth_creds.json").write_text('{"refresh_token": "r"}')
    assert engines._account("gemini", "x") == {"state": "signedIn", "name": ""}
    monkeypatch.setenv("AMP_API_KEY", "k")
    assert engines._account("amp", "x") == {"state": "signedIn", "name": "token in AMP_API_KEY"}

    class Said:
        stdout, stderr = "", ""

    monkeypatch.setattr(engines, "_run", lambda args, timeout=15: Said)
    Said.stdout = "Not logged in\n"
    assert engines._account("codex", "x") == {"state": "signedOut", "name": ""}
    Said.stdout, Said.stderr = "", "Logged in using ChatGPT\n"
    assert engines._account("codex", "x") == {"state": "signedIn", "name": "ChatGPT"}


def test_what_each_tool_prints_when_signed_out_is_understood():
    for eid, text in (
        ("codex", "Not logged in"),
        ("gemini", "Please set an Auth method in your settings.json or specify one of the following environment variables"),
        ("qwen", "No auth type is selected. Please configure an auth type before running in non-interactive mode."),
        ("amp", "Login failed: That code looks incomplete."),
        ("copilot", "Error: No authentication information found."),
    ):
        assert engines.explain(eid, None, 1, text)["what"].endswith("is not signed in"), eid
    assert engines.login_command("gemini") == "gemini" and engines.login_command("opencode") == "opencode auth login"


def test_one_off_questions_run_in_an_empty_folder_away_from_saved_keys(tools):
    said = engines.ask("claude", "where")
    assert engines.ask_dir().is_dir() and not any(engines.ask_dir().iterdir()) and said.startswith("OK")


def test_a_tool_known_to_be_signed_out_is_not_started(tools, monkeypatch):
    monkeypatch.setattr(engines, "_account", lambda engine, exe: {"state": "signedOut", "name": ""})
    engines.status(refresh=True)
    monkeypatch.setattr(engines.subprocess, "run", lambda *a, **k: pytest.fail("the tool was started"))
    with pytest.raises(engines.EngineProblem) as err:
        engines.ask("claude", "hi")
    assert err.value.problem["what"] == "Claude Code is not signed in"


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
    assert "GitHub Copilot CLI is not signed in. Press Sign in on the AI engines page" in out


def test_an_unknown_or_missing_engine_is_refused(auth, tools, tmp_path):
    r = auth.post("/api/agent/send", {"path": str(tmp_path), "prompt": "x", "engine": "skynet"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "That AI engine is not supported"
    tools.pop("copilot")
    r = auth.post("/api/agent/send", {"path": str(tmp_path), "prompt": "x", "engine": "copilot"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "GitHub Copilot CLI was not found"
