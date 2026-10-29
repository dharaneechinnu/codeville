import subprocess

import pytest

from visualizer import projects

pytestmark = pytest.mark.django_db


def post(client, path, body):
    return client.post(path, body, format="json")


def test_templates_are_listed(auth):
    r = auth.get("/api/project/templates")
    assert r.status_code == 200
    assert {t["id"] for t in r.json()["templates"]} == {"empty", "node", "python"}


def test_a_new_node_project_is_created_analyzed_and_started_with_git(auth, tmp_path):
    r = post(auth, "/api/project/new", {"parent": str(tmp_path), "name": "my-shop", "template": "node"})
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["name"] == "my-shop"
    root = tmp_path / "my-shop"
    assert (root / "tests" / "index.test.js").is_file()
    assert '"name": "my-shop"' in (root / "package.json").read_text()
    assert (root / ".git").is_dir()


def test_a_new_python_project_has_a_test(auth, tmp_path):
    r = post(auth, "/api/project/new", {"parent": str(tmp_path), "name": "tool", "template": "python"})
    assert r.status_code == 201
    assert (tmp_path / "tool" / "tests" / "test_main.py").is_file()


def test_bad_names_existing_folders_and_unknown_templates_get_a_next_step(auth, tmp_path):
    (tmp_path / "taken").mkdir()
    for body, what in [
        ({"parent": str(tmp_path), "name": "../evil", "template": "empty"}, "That project name cannot be used"),
        ({"parent": str(tmp_path), "name": "taken", "template": "empty"}, "A folder with that name already exists"),
        ({"parent": str(tmp_path), "name": "ok", "template": "nope"}, "That template does not exist"),
        ({"parent": str(tmp_path / "missing"), "name": "ok", "template": "empty"}, "That folder does not exist"),
    ]:
        r = post(auth, "/api/project/new", body)
        assert r.status_code == 400
        assert r.json()["problem"]["what"] == what
        assert r.json()["problem"]["next"]


def test_clone_copies_a_repository(auth, tmp_path, monkeypatch):
    src = tmp_path / "src"
    src.mkdir()
    for args in (["init", "-b", "main"], ["config", "user.name", "T"], ["config", "user.email", "t@example.com"]):
        subprocess.run(["git", *args], cwd=src, check=True, capture_output=True)
    (src / "a.txt").write_text("x\n")
    subprocess.run(["git", "add", "-A"], cwd=src, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "start"], cwd=src, check=True, capture_output=True)
    dest = tmp_path / "dest"
    dest.mkdir()
    # Only https and ssh links are accepted from the user; the test lets a local path through to avoid the network.
    monkeypatch.setattr(projects, "_git", lambda cwd, *a, **k: subprocess.run(["git", *a[:-2], str(src), a[-1]], cwd=cwd, capture_output=True, text=True))
    r = post(auth, "/api/project/clone", {"parent": str(dest), "url": "https://example.com/team/copy.git"})
    assert r.status_code == 201
    assert (dest / "copy" / "a.txt").is_file()


def test_clone_refuses_things_that_are_not_repository_links(auth, tmp_path):
    for url in ("--upload-pack=evil", "C:\\some\\folder", "ftp://x/y"):
        r = post(auth, "/api/project/clone", {"parent": str(tmp_path), "url": url})
        assert r.status_code == 400
        assert r.json()["problem"]["what"] == "That address is not a repository link"


def test_doctor_reports_each_tool_with_a_next_step_when_missing(auth, monkeypatch):
    from visualizer import doctor

    monkeypatch.setattr(doctor, "find_exe", lambda k: "C:/x/git.exe" if k == "git" else None)
    monkeypatch.setattr(doctor, "_version", lambda exe: "git version 2.0")
    checks = {c["id"]: c for c in auth.get("/api/doctor").json()["checks"]}
    assert checks["git"]["ok"] and checks["git"]["version"] == "git version 2.0"
    assert not checks["claude"]["ok"] and checks["claude"]["next"]
    assert checks["git"]["required"] and not checks["claude"]["required"]


class _Done:
    def __init__(self, code=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def test_connect_adds_the_marketplace_then_installs_and_asks_for_a_restart(auth, monkeypatch):
    from visualizer import connector

    calls = []

    def fake(*args, timeout=120):
        calls.append(args)
        return _Done(0, "code-visualizer@code-visualizer" if args[1] == "list" else "ok")

    monkeypatch.setattr(connector, "_run", fake)
    monkeypatch.setattr(connector, "find_exe", lambda k: "C:/x/claude.exe")
    r = auth.post("/api/agent/connect", {}, format="json")
    assert r.status_code == 200
    assert r.json() == {"claudeFound": True, "installed": True, "restartNeeded": True}
    assert calls[0][:3] == ("plugin", "marketplace", "add") and calls[1] == ("plugin", "install", "code-visualizer@code-visualizer")


def test_connect_without_claude_says_what_to_do(auth, monkeypatch):
    from visualizer import connector

    monkeypatch.setattr(connector, "find_exe", lambda k: None)
    r = auth.post("/api/agent/connect", {}, format="json")
    assert r.status_code == 400
    assert r.json()["problem"]["what"] == "Claude Code was not found" and r.json()["problem"]["next"]
    assert auth.get("/api/agent/status").json() == {"claudeFound": False, "installed": False}


def test_connect_treats_already_added_as_fine_but_reports_real_failures(auth, monkeypatch):
    from visualizer import connector

    monkeypatch.setattr(connector, "find_exe", lambda k: "C:/x/claude.exe")
    monkeypatch.setattr(connector, "_run", lambda *a, timeout=120: _Done(1, "", "Marketplace already exists") if a[1] == "marketplace" else _Done(0, "code-visualizer@code-visualizer"))
    assert auth.post("/api/agent/connect", {}, format="json").status_code == 200
    monkeypatch.setattr(connector, "_run", lambda *a, timeout=120: _Done(1, "", "network down"))
    r = auth.post("/api/agent/connect", {}, format="json")
    assert r.status_code == 400 and r.json()["problem"]["what"] == "Could not add the Codeville plugin to Claude Code"


def test_disconnect_removes_the_plugin_and_the_marketplace_and_is_safe_to_repeat(auth, monkeypatch):
    from visualizer import connector

    calls = []

    def fake(*args, timeout=120):
        calls.append(args)
        if args[1] == "uninstall":
            return _Done(1, "", "Plugin code-visualizer@code-visualizer is not installed") if len(calls) > 2 else _Done(0, "removed")
        return _Done(0, "")

    monkeypatch.setattr(connector, "find_exe", lambda k: "C:/x/claude.exe")
    monkeypatch.setattr(connector, "_run", fake)
    r = auth.post("/api/agent/disconnect", {}, format="json")
    assert r.status_code == 200 and r.json()["restartNeeded"] is True
    assert calls[0] == ("plugin", "uninstall", "code-visualizer@code-visualizer")
    assert ("plugin", "marketplace", "remove", "code-visualizer") in calls
    # a second click when nothing is installed is not an error
    assert auth.post("/api/agent/disconnect", {}, format="json").status_code == 200


def test_disconnect_reports_a_real_failure(auth, monkeypatch):
    from visualizer import connector

    monkeypatch.setattr(connector, "find_exe", lambda k: "C:/x/claude.exe")
    monkeypatch.setattr(connector, "_run", lambda *a, timeout=120: _Done(1, "", "permission denied"))
    r = auth.post("/api/agent/disconnect", {}, format="json")
    assert r.status_code == 400 and r.json()["problem"]["what"] == "Could not remove the Codeville plugin from Claude Code"
