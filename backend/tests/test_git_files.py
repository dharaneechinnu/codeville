import subprocess

import pytest

from visualizer import agent
from visualizer.hub import hub


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Tester")
    git(tmp_path, "config", "user.email", "tester@example.com")
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "CartPage.tsx").write_text("export {}\n")
    (tmp_path / "README.md").write_text("hello\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-m", "start")
    return tmp_path


def post(client, path, body):
    return client.post(path, body, format="json")


def test_a_file_of_the_project_can_be_read(auth, repo):
    r = post(auth, "/api/file", {"path": str(repo), "file": "frontend/CartPage.tsx"})
    assert r.status_code == 200
    body = r.json()
    assert body["file"] == "frontend/CartPage.tsx"
    assert body["text"].replace("\r\n", "\n") == "export {}\n"
    assert body["lines"] == 1 and body["truncated"] is False


def test_files_outside_the_project_and_missing_or_binary_files_are_refused(auth, repo, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "secret.txt"
    outside.write_text("nope")
    assert "outside" in post(auth, "/api/file", {"path": str(repo), "file": "../" + outside.parent.name + "/secret.txt"}).json()["error"]
    assert "outside" in post(auth, "/api/file", {"path": str(repo), "file": str(outside)}).json()["error"]
    assert "does not exist" in post(auth, "/api/file", {"path": str(repo), "file": "nope.ts"}).json()["error"]
    (repo / "pic.bin").write_bytes(b"\x00\x01\x02")
    assert post(auth, "/api/file", {"path": str(repo), "file": "pic.bin"}).json()["error"] == "That file is not text"


def test_changes_stage_and_commit(auth, repo):
    (repo / "frontend" / "CartPage.tsx").write_text("export {}\nexport const a = 1\n")
    (repo / "frontend" / "CouponField.tsx").write_text("export {}\n")
    body = post(auth, "/api/git/changes", {"path": str(repo)}).json()
    by = {f["path"]: f for f in body["files"]}
    assert body["branch"] == "main"
    assert by["frontend/CartPage.tsx"]["status"] == "M" and by["frontend/CartPage.tsx"]["add"] == 1
    assert by["frontend/CouponField.tsx"]["status"] == "A"
    assert not any(f["staged"] for f in body["files"])

    empty = post(auth, "/api/git/commit", {"path": str(repo), "message": "x"})
    assert empty.status_code == 400 and empty.json()["problem"]["what"] == "Nothing staged"

    staged = post(auth, "/api/git/stage", {"path": str(repo), "files": ["frontend/CartPage.tsx"], "stage": True}).json()
    assert {f["path"] for f in staged["files"] if f["staged"]} == {"frontend/CartPage.tsx"}
    back = post(auth, "/api/git/stage", {"path": str(repo), "files": ["frontend/CartPage.tsx"], "stage": False}).json()
    assert not any(f["staged"] for f in back["files"])

    post(auth, "/api/git/stage", {"path": str(repo), "files": ["frontend/CartPage.tsx", "frontend/CouponField.tsx"], "stage": True})
    no_msg = post(auth, "/api/git/commit", {"path": str(repo), "message": "  "})
    assert no_msg.json()["problem"]["what"] == "Commit needs a message"
    ok = post(auth, "/api/git/commit", {"path": str(repo), "message": "Add coupon"})
    assert ok.status_code == 200 and ok.json()["files"] == 2 and ok.json()["branch"] == "main"
    assert any(e["type"] == "git.commit" and e["message"] == "Add coupon" for e in hub.recent(20))
    assert post(auth, "/api/git/changes", {"path": str(repo)}).json()["files"] == []


def test_not_a_repository_says_what_to_do(auth, tmp_path):
    r = post(auth, "/api/git/changes", {"path": str(tmp_path)})
    assert r.status_code == 400
    assert r.json()["problem"]["what"] == "This folder is not a git repository"
    assert "git init" in r.json()["problem"]["next"]


def test_push_problems_are_crisp_and_a_push_with_upstream_works(auth, repo, tmp_path_factory):
    none = post(auth, "/api/git/push", {"path": str(repo)})
    assert none.status_code == 400 and none.json()["problem"]["what"] == "There is no remote to push to"

    bare = tmp_path_factory.mktemp("server")
    git(bare, "init", "--bare", "-b", "main")
    git(repo, "remote", "add", "origin", str(bare))
    no_up = post(auth, "/api/git/push", {"path": str(repo)})
    assert no_up.status_code == 400
    assert no_up.json()["problem"]["what"] == "This branch is not on the server yet"
    assert "origin/main" in no_up.json()["problem"]["next"]

    ok = post(auth, "/api/git/push", {"path": str(repo), "setUpstream": True})
    assert ok.status_code == 200 and ok.json()["branch"] == "main"
    assert post(auth, "/api/git/changes", {"path": str(repo)}).json()["hasUpstream"] is True


def test_sending_a_prompt_says_so_when_claude_code_is_missing(auth, repo, monkeypatch):
    monkeypatch.setattr(agent, "claude_path", lambda: None)
    r = post(auth, "/api/agent/send", {"path": str(repo), "prompt": "Add a coupon field"})
    assert r.status_code == 400
    assert r.json()["problem"]["what"] == "Claude Code was not found"
    assert post(auth, "/api/agent/send", {"path": str(repo), "prompt": ""}).json()["error"] == "Write what you want done"


def test_stopping_something_unknown_is_harmless(auth):
    assert post(auth, "/api/stop", {"runId": "nope"}).json() == {"stopped": False}
