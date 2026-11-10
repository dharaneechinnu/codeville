import json

import pytest

FAILING_TEST = (
    "const test=require('node:test');const assert=require('node:assert');\n"
    "test('adds numbers',()=>{assert.equal(1+1,2)});\n"
    "test('charges the card',()=>{assert.equal(1,2,'Stripe key is missing')});\n"
)


@pytest.fixture
def shop(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "pay.test.js").write_text(FAILING_TEST)
    (tmp_path / "package.json").write_text(json.dumps({"name": "shop", "scripts": {"test": "node --test"}}))
    for rel in ["frontend/CartPage.tsx", "frontend/CartItem.tsx", "backend/payments/charge.js", "backend/auth/login.js"]:
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("// code\n")
    return tmp_path


def call(client, name, body=None):
    return client.post(f"/api/tools/{name}", body or {}, format="json")


def test_the_tool_list_describes_every_tool(auth):
    tools = auth.get("/api/tools").json()["tools"]
    names = {t["name"] for t in tools}
    assert names == {"project_map", "analyze_project", "detect_stack", "find_features", "find_connections", "find_commands", "find_tests", "project_map_request", "save_project_map", "recent_events", "current_problems", "run_check", "git_status"}
    for t in tools:
        assert t["description"] and t["inputSchema"]["type"] == "object"


def test_project_map_lists_features_and_files(auth, shop):
    r = call(auth, "project_map", {"path": str(shop)})
    assert r.status_code == 200
    body = r.json()
    cart = next(f for f in body["features"] if f["name"] == "Cart")
    assert cart["files"] == ["frontend/CartItem.tsx", "frontend/CartPage.tsx"]
    only = call(auth, "project_map", {"path": str(shop), "feature": "cart"}).json()
    assert [f["name"] for f in only["features"]] == ["Cart"]
    missing = call(auth, "project_map", {"path": str(shop), "feature": "Nope"})
    assert missing.status_code == 400 and "Try one of" in missing.json()["error"]


def test_run_check_returns_what_broke_where_and_what_is_next(auth, shop):
    r = call(auth, "run_check", {"kind": "test", "path": str(shop)})
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["status"] == "fail" and body["command"] == "npm test"
    assert body["failed"] == 1 and body["passed"] == 1
    assert "Stripe key is missing" in body["problem"]["broke"]
    assert body["problem"]["where"].startswith("tests/pay.test.js")
    assert body["problem"]["next"].startswith("Fix tests/pay.test.js")
    assert body["failedSteps"][0]["name"].startswith("charges the card")


def test_current_problems_shows_the_failing_check_until_it_passes(auth, shop):
    call(auth, "run_check", {"kind": "test", "path": str(shop)})
    body = call(auth, "current_problems").json()
    assert body["ok"] is False
    assert body["problems"][0]["kind"] == "test"
    (shop / "tests" / "pay.test.js").write_text(FAILING_TEST.replace("assert.equal(1,2,", "assert.equal(1,1,"))
    assert call(auth, "run_check", {"kind": "test", "path": str(shop)}).json()["status"] == "pass"
    assert call(auth, "current_problems").json() == {"ok": True, "problems": []}


def test_run_check_refuses_a_command_that_is_not_that_kind(auth, shop):
    r = call(auth, "run_check", {"kind": "lint", "path": str(shop), "command": "echo hello"})
    assert r.status_code == 400 and "not a lint command" in r.json()["error"]
    assert call(auth, "run_check", {"kind": "banana"}).status_code == 400


def test_recent_events_can_be_filtered(auth, shop):
    call(auth, "run_check", {"kind": "test", "path": str(shop)})
    ends = call(auth, "recent_events", {"types": ["run.end"], "n": 5}).json()["events"]
    assert ends and all(e["type"] == "run.end" for e in ends)


def test_unknown_tools_and_missing_projects_say_what_to_do(auth):
    r = call(auth, "nope")
    assert r.status_code == 400 and "Available:" in r.json()["error"]
    r = call(auth, "git_status", {"path": "C:/definitely/not/here"})
    assert r.status_code == 400 and "does not exist" in r.json()["error"]
