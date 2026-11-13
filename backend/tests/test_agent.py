"""The native Claude Code session: how a turn's stream becomes chat lines and events, and how a prompt is started."""
import json

from visualizer import agent
from visualizer.hub import EventHub


def turn(hooked=False, resumed=False, prompt="add a wishlist", cwd="/p"):
    hub = EventHub(persist=False)
    lines = []
    t = agent.Turn(prompt, cwd, hub, lambda line, stream: lines.append((stream, line)), hooked, resumed)
    return t, hub, lines


def feed(t, *events):
    for e in events:
        t.line(json.dumps(e))


INIT = {"type": "system", "subtype": "init", "session_id": "s-1", "model": "claude-x"}


def delta(text):
    return {"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}}


STOP = {"type": "stream_event", "event": {"type": "content_block_stop"}}


def use(name, **inp):
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]}}


def test_a_turn_without_the_plugin_reports_everything_itself():
    t, hub, lines = turn()
    feed(t, INIT, delta("I will add"), delta(" it.\nNow the"), delta(" page."), STOP,
         use("Write", file_path="/p/src/Wishlist.tsx"), use("Bash", command="npm test"),
         use("mcp__codeville__git_status"),
         {"type": "result", "subtype": "success", "is_error": False, "result": "Added the wishlist page.", "session_id": "s-1"})
    # words arrive as whole lines, tools as short arrows
    assert [l for _, l in lines] == ["I will add it.", "Now the page.", "→ Write /p/src/Wishlist.tsx", "→ Bash npm test", "→ codeville: git_status"]
    ev = hub.recent(20)
    assert [e["type"] for e in ev] == ["session.start", "prompt", "tool", "file.change", "tool", "tool", "turn.end"]
    assert all(e["sessionId"] == "s-1" for e in ev)
    assert ev[1]["text"] == "add a wishlist" and ev[3]["path"] == "src/Wishlist.tsx" and ev[3]["op"] == "write"
    assert ev[-1]["source"] == "app" and ev[-1]["message"] == "Added the wishlist page."
    # the project remembers the session, so the next prompt continues it
    assert agent.session_for("/p") == "s-1"
    agent.forget_session("/p")


def test_with_the_plugin_the_hooks_report_and_the_stream_only_feeds_the_chat():
    t, hub, lines = turn(hooked=True)
    feed(t, INIT, delta("Done."), STOP, use("Edit", file_path="/p/a.py"), {"type": "result", "is_error": False, "result": "Done."})
    assert [l for _, l in lines] == ["Done.", "→ Edit /p/a.py"]
    ev = hub.recent(20)
    assert [e["type"] for e in ev] == ["turn.end"] and ev[0]["message"] is None
    agent.forget_session("/p")


def test_a_continued_conversation_does_not_start_a_new_session():
    t, hub, _ = turn(resumed=True)
    feed(t, INIT, {"type": "result", "is_error": False, "result": "ok"})
    assert [e["type"] for e in hub.recent(20)] == ["prompt", "turn.end"]
    agent.forget_session("/p")


def test_not_signed_in_is_said_in_plain_words():
    t, hub, lines = turn()
    feed(t, INIT, {"type": "result", "is_error": True, "result": "Invalid API key · Please run /login"})
    assert hub.recent(5)[-1]["message"] == agent.SIGN_IN_HELP and ("err", agent.SIGN_IN_HELP) in lines
    # the same when the command fails before the stream starts
    t, hub, _ = turn()
    t.line("Error: Not logged in", "err")
    t.finish(t.failed, failed=True)
    assert hub.recent(5)[-1]["message"] == agent.SIGN_IN_HELP
    agent.forget_session("/p")


def test_a_session_that_is_gone_is_forgotten_so_the_next_prompt_starts_fresh():
    t, _, _ = turn(resumed=True)
    feed(t, INIT)
    assert agent.session_for("/p") == "s-1"
    t.line("No conversation found with session ID: s-1", "err")
    assert agent.session_for("/p") is None and "start a new one" in t.failed


def test_the_command_continues_the_session_and_brings_the_codeville_tools(monkeypatch, tmp_path):
    monkeypatch.setenv("CV_HOME", str(tmp_path))
    args = agent.build_args("claude", "sonnet", True, "s-9", hooked=False)
    assert args[:6] == ["claude", "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    assert args[args.index("--resume") + 1] == "s-9" and args[args.index("--model") + 1] == "sonnet"
    assert args[args.index("--permission-mode") + 1] == "acceptEdits"
    cfg = json.loads(open(args[args.index("--mcp-config") + 1], encoding="utf8").read())
    assert cfg["mcpServers"]["codeville"]["args"][0].replace("\\", "/").endswith("plugin/code-visualizer/scripts/mcp.mjs")
    assert "mcp__codeville" in args[args.index("--allowedTools") + 1]
    # the prompt is never an argument: it goes in on standard input
    assert "add a wishlist" not in args
    # with the plugin installed, the plugin brings the tools itself; a new conversation has nothing to resume
    args = agent.build_args("claude", None, False, None, hooked=True)
    assert "--mcp-config" not in args and "--resume" not in args and "--model" not in args and "--permission-mode" not in args


def test_claude_code_may_not_run_commands_through_codeville_without_asking():
    """Every tool is either pre-approved because it only reads (or saves the map), or it is run_check, which is not."""
    from visualizer.tools import list_tools

    names = {t["name"] for t in list_tools()}
    assert set(agent.SAFE_TOOLS) == names - {"run_check"}
    allowed = agent.build_args("claude", None, True, None, True)
    listed = allowed[allowed.index("--allowedTools") + 1].split(",")
    assert "mcp__codeville__git_status" in listed and "mcp__plugin_code-visualizer_codeville__save_project_map" in listed
    assert not any(t.endswith("run_check") or t in ("mcp__codeville", "mcp__plugin_code-visualizer_codeville") for t in listed)
