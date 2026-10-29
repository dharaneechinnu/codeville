import json
import time

import pytest

from visualizer.hub import hub

FAILING_TEST = (
    "const test=require('node:test');const assert=require('node:assert');\n"
    "test('adds numbers',()=>{assert.equal(1+1,2)});\n"
    "test('charges the card',()=>{assert.equal(1,2,'Stripe key is missing')});\n"
)


def wait_for(fn, seconds=25):
    end = time.time() + seconds
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.1)
    return None


@pytest.fixture
def shop(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "pay.test.js").write_text(FAILING_TEST)
    (tmp_path / "package.json").write_text(json.dumps({"name": "shop", "scripts": {"test": "node --test tests"}}))
    for rel in ["frontend/CartPage.tsx", "backend/payments/charge.js", "backend/auth/login.js"]:
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("// code\n")
    return tmp_path


def test_health_needs_no_token(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_requests_without_the_token_are_refused(client):
    assert client.post("/events", {"type": "session.end", "source": "agent"}, format="json").status_code == 401
    assert client.get("/events").status_code == 401
    assert client.get("/api/tools").status_code == 401


def test_a_wrong_token_is_refused(client):
    client.credentials(HTTP_X_CV_TOKEN="nope")
    assert client.get("/events").status_code == 401


def test_other_sites_and_spoofed_hosts_are_refused(auth):
    assert auth.post("/events", {"type": "session.end", "source": "agent"}, format="json", HTTP_ORIGIN="https://evil.example").status_code == 403
    assert auth.get("/health", HTTP_HOST="evil.example").status_code == 403
    ok = auth.get("/health", HTTP_ORIGIN="null")
    assert ok.status_code == 200 and ok["Access-Control-Allow-Origin"] == "null"
    assert auth.get("/health", HTTP_ORIGIN="http://localhost:5180").status_code == 200
    app = auth.get("/health", HTTP_ORIGIN="app://codeville")
    assert app.status_code == 200 and app["Access-Control-Allow-Origin"] == "app://codeville"
    assert auth.get("/health", HTTP_ORIGIN="app://evil").status_code == 403


def test_good_events_are_accepted_and_bad_ones_rejected(auth):
    r = auth.post("/events", [{"type": "prompt", "source": "agent", "text": "hello"}, {"type": "nonsense", "source": "agent"}], format="json")
    assert r.status_code == 202 and r.json() == {"accepted": 1, "rejected": 1}
    assert auth.post("/events", {"nope": True}, format="json").status_code == 400
    listed = auth.get("/events?n=10").json()
    assert any(e["type"] == "prompt" for e in listed)
    assert all(isinstance(e["id"], str) and isinstance(e["ts"], int) for e in listed)


def test_a_claude_code_hook_becomes_events(auth):
    r = auth.post(
        "/hook/claude-code",
        {"hook_event_name": "PostToolUse", "cwd": "C:\\p", "tool_name": "Write", "tool_input": {"file_path": "C:\\p\\backend\\auth\\login.ts"}},
        format="json",
    )
    assert r.status_code == 202
    change = next(e for e in hub.recent(5) if e["type"] == "file.change")
    assert change["path"] == "backend/auth/login.ts"


def test_a_real_test_run_streams_steps_with_short_paths(auth, shop):
    r = auth.post("/api/run", {"command": f'node --test "{shop / "tests" / "pay.test.js"}"', "cwd": str(shop)}, format="json")
    assert r.status_code == 202
    run_id = r.json()["runId"]
    end = wait_for(lambda: hub.find(lambda e: e["type"] == "run.end" and e.get("runId") == run_id))
    assert end and end["status"] == "fail"
    mine = [e for e in hub.recent(300) if e.get("runId") == run_id]
    assert any(e["type"] == "step.pass" and "adds numbers" in e["name"] for e in mine)
    fail = next(e for e in mine if e["type"] == "step.fail")
    assert "charges the card" in fail["name"]
    assert "Stripe key is missing" in " ".join(fail["problem"]["why"])
    assert fail["problem"]["file"] == "tests/pay.test.js"
    assert ":\\" not in fail["problem"]["next"] and ":/" not in fail["problem"]["next"]


@pytest.mark.django_db
def test_analyze_a_folder_and_refuse_a_missing_one(auth, shop):
    ok = auth.post("/api/analyze", {"path": str(shop)}, format="json")
    assert ok.status_code == 200 and ok.json()["totalFiles"] >= 3
    bad = auth.post("/api/analyze", {"path": str(shop / "missing")}, format="json")
    assert bad.status_code == 400 and "does not exist" in bad.json()["error"]
    assert auth.post("/api/analyze", {}, format="json").json()["error"] == "Send a folder path"


@pytest.mark.django_db
def test_events_are_kept_in_the_database(auth):
    from visualizer.models import Event

    hub._persist = True
    try:
        e = hub.push({"type": "prompt", "source": "agent", "text": "kept"})
    finally:
        hub._persist = False
    assert Event.objects.get(id=e["id"]).payload["text"] == "kept"


@pytest.mark.django_db
def test_the_event_stream_replays_recent_events_and_follows_new_ones(auth):
    hub.push({"type": "prompt", "source": "agent", "text": "before"})
    r = auth.get("/stream", HTTP_ACCEPT="text/event-stream")
    assert r.status_code == 200 and r["Content-Type"].startswith("text/event-stream")
    chunks = r.streaming_content
    first = next(chunks).decode()
    assert first.startswith(": connected")
    seen = ""
    for _ in range(120):  # the backlog arrives first
        piece = next(chunks).decode()
        seen += piece
        if '"before"' in piece:
            break
    assert '"before"' in seen
    hub.push({"type": "prompt", "source": "agent", "text": "after"})
    assert '"after"' in next(chunks).decode()
    r.close()
