# Codeville plugin for Claude Code

Sends file edits, tool calls, sub-agent starts and test, lint and build runs to the Codeville app.

Install, from Claude Code:

```
/plugin marketplace add <path to this plugin folder>
/plugin install code-visualizer@code-visualizer
```

Start the Codeville app once, so it writes `~/.code-visualizer/config.json`. The plugin reads the port and token from there.
It needs Node 18 or newer on your PATH. If the app is not running, the plugin does nothing and never slows Claude Code down.
