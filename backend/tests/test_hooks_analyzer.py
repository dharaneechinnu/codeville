from visualizer.analyzer import analyze_project
from visualizer.claude_hooks import from_claude_hook, read_tool_result


def types(events):
    return [e["type"] for e in events]


def test_an_edit_becomes_a_tool_event_and_a_file_change_with_a_short_path():
    events = from_claude_hook(
        {
            "hook_event_name": "PostToolUse", "session_id": "s1", "cwd": "C:\\proj", "tool_name": "Edit",
            "tool_input": {"file_path": "C:\\proj\\frontend\\CartPage.tsx"}, "agent_id": "a1",
        }
    )
    assert types(events) == ["tool", "file.change"]
    assert events[1]["path"] == "frontend/CartPage.tsx"
    assert events[1]["op"] == "edit"


def test_sub_agents_are_followed():
    assert from_claude_hook({"hook_event_name": "SubagentStart", "agent_id": "x", "agent_type": "general-purpose"})[0]["type"] == "agent.start"
    assert from_claude_hook({"hook_event_name": "SubagentStop", "agent_id": "x"})[0]["type"] == "agent.stop"


def test_a_test_command_starts_a_run_and_finishes_it_with_steps():
    pre = from_claude_hook({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_use_id": "t1", "tool_input": {"command": "npm test"}})
    assert types(pre) == ["tool", "run.start"]
    post = from_claude_hook(
        {
            "hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_use_id": "t1", "tool_input": {"command": "npm test"},
            "tool_response": {"stdout": "ok 1 - adds\nnot ok 2 - charges\n  error: boom\n  at: src/pay.test.js:9:1", "stderr": "", "exit_code": 1},
        }
    )
    assert "step.pass" in types(post) and "step.fail" in types(post)
    end = next(e for e in post if e["type"] == "run.end")
    assert end["status"] == "fail"
    assert end["runId"] == next(e for e in pre if e["type"] == "run.start")["runId"] == "run-t1"


def test_plain_shell_commands_are_only_reported_as_tools():
    assert types(from_claude_hook({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls"}})) == ["tool"]


def test_prompt_and_end_of_turn():
    assert from_claude_hook({"hook_event_name": "UserPromptSubmit", "prompt": "Build a shop"})[0]["type"] == "prompt"
    assert from_claude_hook({"hook_event_name": "Stop", "last_assistant_message": "Done"})[0]["type"] == "turn.end"


def test_unknown_events_are_ignored():
    assert from_claude_hook({"hook_event_name": "PreCompact"}) == []
    assert from_claude_hook({}) == []


def test_read_tool_result_handles_strings_objects_and_nothing():
    assert read_tool_result("hi")["text"] == "hi"
    assert read_tool_result({"stdout": "a", "stderr": "b", "exit_code": 2}) == {"text": "a\nb", "exit_code": 2}
    assert read_tool_result(None)["text"] == ""


def put(root, rel, lines=5):
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("\n".join(f"// {i}" for i in range(lines)))


def test_analyzer_groups_an_online_shop_and_ignores_noise(tmp_path):
    put(tmp_path, "frontend/CartPage.tsx", 40)
    put(tmp_path, "frontend/CartItem.tsx")
    put(tmp_path, "frontend/ProductList.tsx", 60)
    put(tmp_path, "frontend/ProductCard.tsx")
    put(tmp_path, "backend/payments/charge.ts", 30)
    put(tmp_path, "backend/payments/webhook.ts")
    put(tmp_path, "backend/auth/login.ts")
    put(tmp_path, "backend/auth/session.ts")
    put(tmp_path, "db/schema.sql")
    put(tmp_path, "frontend/AdminPanel.tsx")
    put(tmp_path, "README.md")
    put(tmp_path, "node_modules/pkg/index.js")
    put(tmp_path, "dist/bundle.js")
    a = analyze_project(str(tmp_path))
    names = [f["name"] for f in a["features"]]
    assert set(names) >= {"Cart", "Products", "Payment", "Login & Auth", "Database", "Admin"}
    assert a["kind"] == "Online shop"
    assert a["totalFiles"] == 10
    cart = next(f for f in a["features"] if f["name"] == "Cart")
    assert [f["path"] for f in cart["files"]] == ["frontend/CartItem.tsx", "frontend/CartPage.tsx"]
    assert cart["path"] == "frontend/CartPage"
    everything = [f["path"] for feat in a["features"] for f in feat["files"]]
    assert not any("node_modules" in p for p in everything)
    assert len(set(everything)) == len(everything)  # a file never belongs to two features
