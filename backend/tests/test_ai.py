import json
import os
import stat
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from visualizer import ai
from visualizer.hub import hub

ORIGINAL = "def total(lines):\n    return sum(l['price'] for l in lines)\n"
UPDATED = "def total(lines):\n    return sum(l['price'] * l['quantity'] for l in lines)\n"


class FakeModel(BaseHTTPRequestHandler):
    """An OpenAI-compatible chat endpoint that answers with a fixed reply, or an error."""

    reply = "Multiplied each price by its quantity.\n```python\n" + UPDATED + "```"
    status_code = 200
    seen: list = []

    def do_POST(self):  # noqa: N802 - the http.server API
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        FakeModel.seen.append({"path": self.path, "auth": self.headers.get("authorization"), "body": body})
        if FakeModel.status_code != 200:
            self.send_response(FakeModel.status_code)
            self.end_headers()
            self.wfile.write(json.dumps({"error": {"message": "model_not_found"}}).encode())
            return
        out = {"choices": [{"message": {"role": "assistant", "content": FakeModel.reply}, "finish_reason": "stop"}]}
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(out).encode())

    def log_message(self, *args):
        pass


@pytest.fixture
def model_url():
    server = HTTPServer(("127.0.0.1", 0), FakeModel)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeModel.seen, FakeModel.status_code = [], 200
    yield f"http://127.0.0.1:{server.server_port}/v1"
    server.shutdown()


@pytest.fixture(autouse=True)
def fresh_settings():
    if ai.settings_path().exists():
        ai.settings_path().unlink()
    yield


@pytest.fixture
def project(tmp_path):
    (tmp_path / "store").mkdir()
    (tmp_path / "store" / "pricing.py").write_text(ORIGINAL)
    return tmp_path


def configure(auth, model_url, key="sk-test-123456789"):
    return auth.post("/api/ai/settings", {"provider": "custom", "apiKey": key, "model": "coder-1", "baseUrl": model_url, "makeActive": True}, format="json")


def test_settings_never_send_the_key_back(auth, model_url):
    r = configure(auth, model_url)
    assert r.status_code == 200, r.content
    custom = next(p for p in r.json()["providers"] if p["id"] == "custom")
    assert custom["hasKey"] and custom["keyHint"] == "…6789" and custom["ready"]
    assert "sk-test-123456789" not in json.dumps(r.json())
    assert r.json()["active"] == "custom"
    if os.name != "nt":
        assert stat.S_IMODE(os.stat(ai.settings_path()).st_mode) == 0o600


def test_free_and_paid_providers_are_listed(auth):
    providers = {p["id"]: p for p in auth.get("/api/ai/settings").json()["providers"]}
    assert {"groq", "deepseek", "gemini", "openrouter", "ollama", "anthropic", "openai", "custom"} <= set(providers)
    assert providers["groq"]["tier"] == "free" and providers["deepseek"]["tier"] == "paid" and providers["ollama"]["tier"] == "local"
    assert providers["anthropic"]["model"] == "claude-opus-5-5"
    assert providers["ollama"]["ready"] and not providers["groq"]["ready"]


def test_edit_returns_the_proposed_file_without_saving_it(auth, model_url, project):
    configure(auth, model_url)
    r = auth.post("/api/ai/edit", {"path": str(project), "file": "store/pricing.py", "instruction": "use the quantity"}, format="json")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["updated"] == UPDATED and body["original"] == ORIGINAL and body["changed"]
    assert body["summary"] == "Multiplied each price by its quantity." and body["model"] == "coder-1"
    assert (project / "store" / "pricing.py").read_text() == ORIGINAL
    sent = FakeModel.seen[0]
    assert sent["path"] == "/v1/chat/completions" and sent["auth"] == "Bearer sk-test-123456789"
    assert "use the quantity" in sent["body"]["messages"][1]["content"] and ORIGINAL in sent["body"]["messages"][1]["content"]


def test_accepting_an_edit_saves_it_and_lights_the_town(auth, project):
    r = auth.post("/api/file/write", {"path": str(project), "file": "store/pricing.py", "content": UPDATED, "base": ORIGINAL}, format="json")
    assert r.status_code == 200, r.content
    assert (project / "store" / "pricing.py").read_text() == UPDATED
    assert any(e["type"] == "file.change" and e["path"] == "store/pricing.py" for e in hub.recent(5))


def test_saving_refuses_when_the_file_changed_meanwhile(auth, project):
    (project / "store" / "pricing.py").write_text("# someone else edited this\n")
    r = auth.post("/api/file/write", {"path": str(project), "file": "store/pricing.py", "content": UPDATED, "base": ORIGINAL}, format="json")
    assert r.status_code == 409 and "changed since" in r.json()["error"]
    assert (project / "store" / "pricing.py").read_text() == "# someone else edited this\n"


def test_saving_never_writes_outside_the_project(auth, project):
    r = auth.post("/api/file/write", {"path": str(project / "store"), "file": "../../outside.txt", "content": "x", "base": ""}, format="json")
    assert r.status_code == 400 and "outside" in r.json()["error"]


def test_no_model_set_up_says_where_to_add_one(auth, project):
    r = auth.post("/api/ai/edit", {"path": str(project), "file": "store/pricing.py", "instruction": "x"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "No AI model is set up yet"
    assert "Extensions" in r.json()["problem"]["next"]


def test_a_missing_key_points_to_the_provider_site(auth, project):
    auth.post("/api/ai/settings", {"provider": "groq", "makeActive": True}, format="json")
    r = auth.post("/api/ai/edit", {"path": str(project), "file": "store/pricing.py", "instruction": "x"}, format="json")
    assert r.json()["error"] == "Groq has no API key" and "console.groq.com" in r.json()["problem"]["next"]


def test_provider_errors_say_what_to_do(auth, model_url, project):
    configure(auth, model_url)
    FakeModel.status_code = 404
    r = auth.post("/api/ai/edit", {"path": str(project), "file": "store/pricing.py", "instruction": "x"}, format="json")
    assert r.status_code == 502 and r.json()["error"] == "Custom (OpenAI-compatible) does not know the model coder-1"
    FakeModel.status_code = 401
    r = auth.post("/api/ai/edit", {"path": str(project), "file": "store/pricing.py", "instruction": "x"}, format="json")
    assert "did not accept the API key" in r.json()["error"]


def test_a_reply_without_a_file_is_reported(auth, model_url, project):
    configure(auth, model_url)
    FakeModel.reply = "Sorry, I cannot help with that."
    try:
        r = auth.post("/api/ai/edit", {"path": str(project), "file": "store/pricing.py", "instruction": "x"}, format="json")
    finally:
        FakeModel.reply = "Multiplied each price by its quantity.\n```python\n" + UPDATED + "```"
    assert r.status_code == 502 and r.json()["error"] == "The model did not send back a file"


def test_test_button_reports_the_model(auth, model_url):
    configure(auth, model_url)
    FakeModel.reply = "OK"
    try:
        r = auth.post("/api/ai/test", {}, format="json")
    finally:
        FakeModel.reply = "Multiplied each price by its quantity.\n```python\n" + UPDATED + "```"
    assert r.status_code == 200 and r.json()["ok"] and r.json()["model"] == "coder-1"


def test_parse_edit_takes_the_longest_block():
    summary, body = ai.parse_edit("Did it.\n```ts\nshort\n```\nand\n```ts\nthe whole file\nline 2\n```")
    assert summary == "Did it." and body == "the whole file\nline 2"
