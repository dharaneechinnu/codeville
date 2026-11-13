"""The development team. A stand-in plays each agent, so the Lead's choices, the gates and the limits on what each
agent may change are checked without a real Claude Code."""
import json
import os
import stat
import subprocess
import sys
import time

import pytest

from visualizer import agent, team
from visualizer.hub import hub


def done(note: str = "Done.", **result) -> str:
    return note + "\n" + json.dumps({"status": "done", "needs": [], "severity": "none", **result})


class Script:
    """What each agent does when it is called: a function (root, prompt) -> reply text."""

    def __init__(self, **plays):
        self.plays = plays
        self.calls: list = []

    def __call__(self, role, prompt, root, hub_, emit, model, on_proc):
        self.calls.append(role)
        play = self.plays.get(role, lambda r, p: done(f"{role} did its part."))
        if isinstance(play, list):
            play = play.pop(0) if len(play) > 1 else play[0]
        emit(f"{role} is working", "out")
        return play(root, prompt), False


def lead(*roles, summary="Do it."):
    return lambda root, prompt: json.dumps({"steps": [{"role": r, "why": f"{r} is needed"} for r in roles], "tasks": ["the task"], "summary": summary})


def write(rel, text="x\n"):
    def go(root):
        f = os.path.join(root, rel)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        with open(f, "w") as fh:
            fh.write(text)
    return go


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    team._current["run"] = None
    monkeypatch.setattr(team, "settings_path", lambda: tmp_path / "team.json")
    yield
    run = team.current()
    if run and run.state not in ("done", "stopped", "failed"):
        team.Team(hub).stop(run.id)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "shop"
    (root / "src").mkdir(parents=True)
    (root / "src" / "cart.py").write_text("def total(lines):\n    return 0\n")
    (root / "tests").mkdir()
    (root / "tests" / "test_cart.py").write_text("def test_total():\n    assert True\n")
    return root


def play(monkeypatch, script):
    monkeypatch.setattr(team, "run_stage", script)
    return script


def wait(state, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        run = team.current()
        if run and run.state == state:
            return run
        time.sleep(0.02)
    raise AssertionError(f"the run never reached {state}; it is {team.current() and team.current().state}")


def agree(auth, run, roles=None):
    body = {"runId": run.id, "gate": "pick", **({"roles": roles} if roles is not None else {})}
    r = auth.post("/api/team/answer", body, format="json")
    assert r.status_code == 200, r.content
    return r


def start(auth, project, request):
    r = auth.post("/api/team/start", {"path": str(project), "request": request}, format="json")
    assert r.status_code == 202, r.content
    return r.json()


def test_a_small_fix_uses_only_the_developer(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("developer"), developer=lambda root, p: (write("src/cart.py", "def total(lines):\n    return 1\n")(root), done("Changed total."))[1]))
    start(auth, project, "Fix the typo in the cart total")
    run = wait("pick")
    assert [p["role"] for p in run.pick] == ["developer"] and run.pick[0]["why"] == "developer is needed"
    agree(auth, run)
    run = wait("done")
    assert script.calls == ["lead", "developer"]
    assert run.changed == ["src/cart.py"] and run.commit is None
    assert (project / run.notes / "01-developer.md").read_text().startswith("# Developer\n\nChanged total.")
    assert (project / ".codeville" / "team" / ".gitignore").read_text() == "*\n"
    assert "Developer: done" in (project / run.notes / "summary.md").read_text()
    events = [e for e in hub.recent(200) if e["type"] == "team.run"]
    assert events and events[-1]["run"]["state"] == "done"


def test_the_lead_sees_the_request_and_each_agent_sees_the_notes_before_it(auth, project, monkeypatch):
    prompts: dict = {}

    def keep(role, reply):
        return lambda root, p: (prompts.__setitem__(role, p), reply)[1]

    play(monkeypatch, Script(lead=lambda r, p: (prompts.__setitem__("lead", p), lead("architect", "developer")(r, p))[1],
                             architect=keep("architect", done("Put it in cart.py.")), developer=keep("developer", done("Did it."))))
    team.save_settings({"approveDesign": False})
    start(auth, project, "Add a discount field")
    agree(auth, wait("pick"))
    wait("done")
    assert "Add a discount field" in prompts["lead"] and "SMALLEST team" in prompts["lead"]
    assert "## Architect\nPut it in cart.py." in prompts["developer"] and "You are the Developer" in prompts["developer"]


def test_sign_in_work_always_gets_security_and_it_cannot_be_removed(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("developer")))
    start(auth, project, "Add login with Google")
    run = wait("pick")
    sec = next(p for p in run.pick if p["role"] == "security")
    assert sec["locked"] and "login" in sec["why"]
    agree(auth, run, roles=["developer"])
    run = wait("done")
    assert script.calls == ["lead", "developer", "security"]


def test_security_is_switched_off_but_still_runs_for_payments(auth, project, monkeypatch):
    team.save_settings({"roles": {"security": {"enabled": False}}})
    play(monkeypatch, Script(lead=lead("developer", "security")))
    start(auth, project, "Add Stripe checkout")
    run = wait("pick")
    assert [p["role"] for p in run.pick] == ["developer", "security"] and run.pick[1]["locked"]


def test_security_is_added_when_the_code_turns_out_to_touch_payments(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("developer"), developer=lambda root, p: (write("src/payments/charge.py")(root), done())[1]))
    start(auth, project, "Tidy the cart code")
    agree(auth, wait("pick"))
    run = wait("done")
    assert script.calls == ["lead", "developer", "security"]
    assert run.stages[1].added == "The Lead added Security after the code was written." and "payments/charge.py" in run.stages[1].why


def test_you_can_add_and_remove_specialists(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("ux", "developer")))
    start(auth, project, "Make the cart page nicer")
    agree(auth, wait("pick"), roles=["developer", "tester"])
    run = wait("done")
    assert script.calls == ["lead", "developer", "tester"] and run.pick[1]["why"] == "Added by you"


def test_agents_cannot_change_what_they_may_not(auth, project, monkeypatch):
    def reviewer(root, p):
        write("src/cart.py", "hacked\n")(root)
        return done("Looked.")

    def tester(root, p):
        write("tests/test_new.py", "def test_new():\n    pass\n")(root)
        write("src/cart.py", "changed by the tester\n")(root)
        return done()

    def developer(root, p):
        write("src/discount.py")(root)
        write(".env", "SECRET=1\n")(root)
        return done()

    play(monkeypatch, Script(lead=lead("developer", "tester", "security"), developer=developer, tester=tester, security=reviewer))
    start(auth, project, "Add a discount")
    agree(auth, wait("pick"))
    run = wait("done")
    by = {s.role: s for s in run.stages}
    assert by["developer"].changed == ["src/discount.py"] and by["developer"].putBack == [".env"] and not (project / ".env").exists()
    assert by["tester"].changed == ["tests/test_new.py"] and by["tester"].putBack == ["src/cart.py"]
    assert by["security"].putBack == ["src/cart.py"] and by["security"].changed == []
    assert (project / "src" / "cart.py").read_text() == "def total(lines):\n    return 0\n"
    assert "may not change them" in by["security"].note
    assert sorted(run.changed) == ["src/discount.py", "tests/test_new.py"]


def test_the_design_is_approved_before_any_code_is_written(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("architect", "developer")))
    start(auth, project, "Add wish lists")
    agree(auth, wait("pick"))
    run = wait("design")
    assert script.calls == ["lead", "architect"]
    auth.post("/api/team/answer", {"runId": run.id, "gate": "design", "approve": False}, format="json")
    run = wait("stopped")
    assert script.calls == ["lead", "architect"] and run.stages[1].status == "stopped"


def test_explaining_needs_no_design_approval(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("architect")))
    start(auth, project, "Explain how the cart works")
    agree(auth, wait("pick"))
    wait("done")
    assert script.calls == ["lead", "architect"]


def test_failing_tests_send_the_developer_back_at_most_twice(auth, project, monkeypatch):
    fail = lambda root, p: done("test_total fails at tests/test_cart.py:2", status="fail")  # noqa: E731
    script = play(monkeypatch, Script(lead=lead("developer", "tester"), tester=fail))
    start(auth, project, "Make totals include quantity")
    agree(auth, wait("pick"))
    run = wait("done")
    assert script.calls == ["lead", "developer", "tester", "developer", "tester", "developer", "tester"]
    assert run.stages[3].added == "Fix round 1 of 2" and run.stages[5].added == "Fix round 2 of 2"


def test_failing_tests_first_run_the_tester_then_the_developer(auth, project, monkeypatch):
    prompts = []
    calls = [lambda r, p: done("cart test fails", status="fail"), lambda r, p: done("all pass")]
    script = play(monkeypatch, Script(lead=lead("tester", "developer", "tester"), tester=calls,
                                      developer=lambda r, p: (prompts.append(p), done())[1]))
    start(auth, project, "The cart tests are failing")
    agree(auth, wait("pick"))
    wait("done")
    assert script.calls[:4] == ["lead", "tester", "developer", "tester"]
    assert "The Tester found failures" in prompts[0]


def test_a_specialist_can_ask_the_lead_for_help(auth, project, monkeypatch):
    dev = [lambda r, p: done("Needs a new table.", needs=["architect"]), lambda r, p: done("Done with the table.")]
    script = play(monkeypatch, Script(lead=lead("developer"), developer=dev))
    team.save_settings({"approveDesign": False})
    start(auth, project, "Save carts between visits")
    agree(auth, wait("pick"))
    run = wait("done")
    assert script.calls == ["lead", "developer", "architect", "developer"]
    assert run.stages[1].added == "Asked for by the Developer"


def test_an_agent_cannot_pull_in_testing_or_a_release(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("developer"), developer=lambda r, p: done("Done.", needs=["tester", "deployment", "security"])))
    start(auth, project, "Change the cart title")
    agree(auth, wait("pick"))
    run = wait("done")
    assert script.calls == ["lead", "developer"] and run.commit is None


def test_a_high_security_finding_waits_for_you(auth, project, monkeypatch):
    script = play(monkeypatch, Script(lead=lead("security", "deployment"), security=lambda r, p: done("Secret in config.py:3", severity="high")))
    start(auth, project, "Is the app safe to launch, then prepare a release")
    agree(auth, wait("pick"))
    run = wait("security")
    auth.post("/api/team/answer", {"runId": run.id, "gate": "security", "proceed": False}, format="json")
    wait("stopped")
    assert script.calls == ["lead", "security"]


def test_deployment_commits_only_the_teams_files_and_never_pushes(auth, project, monkeypatch):
    git = lambda *a: subprocess.run(["git", *a], cwd=project, capture_output=True, text=True)  # noqa: E731
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "T")
    git("add", "-A")
    git("commit", "-qm", "start")
    (project / "notes.txt").write_text("mine, not the team's\n")
    (project / "staged.txt").write_text("staged by me\n")
    git("add", "staged.txt")

    def developer(r, p):
        write("src/cart.py", "v2\n")(r)
        write("src/scratch.py")(r)
        return done()

    def tidy(r, p):
        os.remove(os.path.join(r, "src", "scratch.py"))  # made by the team, then removed again
        return done()

    tester = lambda r, p: (write("tests/test_more.py", "def test_more():\n    pass\n")(r), done())[1]  # noqa: E731
    play(monkeypatch, Script(lead=lead("developer", "developer", "tester", "deployment"), developer=[developer, tidy], tester=tester,
                             deployment=lambda r, p: (write(".github/workflows/ci.yml", "on: push\n")(r), done("Release notes."))[1]))
    start(auth, project, "Release the new cart")
    agree(auth, wait("pick"))
    run = wait("done")
    assert run.commit and run.commit["files"] == 3, run.commit
    shown = git("show", "--name-only", "--format=%s", "HEAD").stdout.split()
    assert {"src/cart.py", "tests/test_more.py", ".github/workflows/ci.yml"} <= set(shown)
    assert not {"notes.txt", "staged.txt", "src/scratch.py"} & set(shown)
    assert git("status", "--porcelain").stdout.splitlines() == ["A  staged.txt", "?? notes.txt"]
    assert "Push it from Source control" in run.summary


def test_checks_that_could_not_run_are_never_shown_as_passed(auth, project, monkeypatch):
    def tester(root, p):
        hub.push({"type": "run.end", "source": "terminal", "runId": "r1", "kind": "test", "status": "fail", "passed": 0, "failed": 0, "skipped": 0, "ms": 5,
                  "problem": {"what": "The tests did not run", "why": ["No module named pytest"], "file": None, "line": None, "next": "Install it."}})
        return done("All good.")

    play(monkeypatch, Script(lead=lead("tester"), tester=tester))
    start(auth, project, "Check the cart")
    agree(auth, wait("pick"))
    run = wait("done")
    assert run.stages[0].result["didNotRun"] == ["test: No module named pytest"]
    assert "## Checks that could not run" in run.summary and "cannot install packages" in run.summary


def test_one_run_at_a_time_and_stop(auth, project, monkeypatch):
    play(monkeypatch, Script(lead=lead("developer")))
    run = start(auth, project, "One thing")
    wait("pick")
    r = auth.post("/api/team/start", {"path": str(project), "request": "Another thing"}, format="json")
    assert r.status_code == 409 and r.json()["error"] == "The team is already working"
    auth.post("/api/team/stop", {"runId": run["id"]}, format="json")
    wait("stopped")
    assert auth.get("/api/team").json()["run"]["state"] == "stopped"


def test_a_lead_that_picks_nobody_says_what_to_do(auth, project, monkeypatch):
    play(monkeypatch, Script(lead=lambda r, p: "I am not sure."))
    start(auth, project, "Hmm")
    run = wait("failed")
    assert run.problem["what"] == "The Lead did not pick a team"


def test_settings_and_roles(auth):
    body = auth.get("/api/team").json()
    assert [r["id"] for r in body["roles"]] == ["lead", "architect", "ux", "developer", "tester", "security", "deployment"]
    assert body["approveDesign"] is True and body["run"] is None
    r = auth.post("/api/team/settings", {"approveDesign": False, "roles": {"ux": {"enabled": False, "model": "sonnet", "extra": "Use our design system."}, "lead": {"enabled": False}}}, format="json").json()
    ux = next(x for x in r["roles"] if x["id"] == "ux")
    assert r["approveDesign"] is False and ux["enabled"] is False and ux["model"] == "sonnet" and ux["extra"] == "Use our design system."
    assert next(x for x in r["roles"] if x["id"] == "lead")["enabled"] is True


def test_each_agent_is_started_with_its_own_tools(tmp_path, monkeypatch):
    """The real starter, with a stand-in `claude` that reports how it was started."""
    script = tmp_path / "claude.py"
    script.write_text(
        "import json, sys\n"
        "sys.stdin.read()\n"
        "print(json.dumps({'type': 'system', 'subtype': 'init', 'session_id': 'team-session'}))\n"
        "print(json.dumps({'type': 'result', 'result': json.dumps(sys.argv[1:]), 'is_error': False}))\n"
    )
    exe = tmp_path / "claude"
    exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    if os.name == "nt":
        pytest.skip("uses a shell stand-in")
    monkeypatch.setattr(agent, "claude_path", lambda: str(exe))
    with agent._lock:
        agent._sessions[agent._key(str(tmp_path))] = "chat-session"

    def args(role):
        text, failed = team._claude_stage(role, "hi", str(tmp_path), hub, lambda l, s: None, "", lambda p: None)
        assert not failed
        return json.loads(text)

    sec, dev, tester = args("security"), args("developer"), args("tester")
    assert sec[sec.index("--tools") + 1] == "Read,Glob,Grep" and "--permission-mode" not in sec
    assert dev[dev.index("--tools") + 1] == "Read,Glob,Grep,Edit,Write,NotebookEdit" and dev[dev.index("--permission-mode") + 1] == "acceptEdits"
    assert not any("run_check" in a for a in dev) and "mcp__codeville__run_check" in tester[tester.index("--allowedTools") + 1]
    assert not any(w in " ".join(sec + dev + tester) for w in ("Bash", "bypassPermissions", "dangerously"))
    assert agent.session_for(str(tmp_path)) == "chat-session"
