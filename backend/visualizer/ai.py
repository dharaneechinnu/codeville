"""AI edits with your own key: one file, one instruction, the whole updated file back.

Providers are either Anthropic (through its official SDK) or any service that speaks the OpenAI-compatible
chat API (DeepSeek, Groq, Gemini, OpenRouter, Ollama, OpenAI, or a custom URL). Keys are kept in ai.json in the
config folder on this computer, readable only by this user, and are never sent back to the window.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from .config import config_dir
from .events import problem

# tier: "free" (free tier or free models), "local" (runs on this computer), "paid" (billed per use).
PROVIDERS: dict = {
    "groq": {"label": "Groq", "tier": "free", "api": "openai", "base": "https://api.groq.com/openai/v1",
             "models": ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b"], "keyUrl": "https://console.groq.com/keys"},
    "gemini": {"label": "Google Gemini", "tier": "free", "api": "openai", "base": "https://generativelanguage.googleapis.com/v1beta/openai",
               "models": ["gemini-2.5-flash", "gemini-2.5-pro"], "keyUrl": "https://aistudio.google.com/apikey"},
    "openrouter": {"label": "OpenRouter", "tier": "free", "api": "openai", "base": "https://openrouter.ai/api/v1",
                   "models": ["deepseek/deepseek-chat-v3-0324:free", "qwen/qwen-2.5-coder-32b-instruct:free"], "keyUrl": "https://openrouter.ai/keys"},
    "ollama": {"label": "Ollama (on this computer)", "tier": "local", "api": "openai", "base": "http://localhost:11434/v1",
               "models": ["qwen2.5-coder", "llama3.1"], "keyUrl": "https://ollama.com/download", "noKey": True},
    "deepseek": {"label": "DeepSeek", "tier": "paid", "api": "openai", "base": "https://api.deepseek.com/v1",
                 "models": ["deepseek-chat", "deepseek-reasoner"], "keyUrl": "https://platform.deepseek.com/api_keys"},
    "anthropic": {"label": "Anthropic Claude", "tier": "paid", "api": "anthropic", "base": "https://api.anthropic.com",
                  "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], "keyUrl": "https://console.anthropic.com/settings/keys"},
    "openai": {"label": "OpenAI", "tier": "paid", "api": "openai", "base": "https://api.openai.com/v1",
               "models": ["gpt-4.1-mini", "gpt-4.1"], "keyUrl": "https://platform.openai.com/api-keys"},
    "custom": {"label": "Custom (OpenAI-compatible)", "tier": "any", "api": "openai", "base": "", "models": [], "keyUrl": "", "optionalKey": True},
}

# Claude models that accept the server-side refusal fallback ("default" routing).
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"}
MAX_EDIT_CHARS = 120_000
TIMEOUT = 180

SYSTEM = (
    "You edit one file of a software project. Apply the user's instruction to the file and keep everything else "
    "exactly as it is: same style, indentation, imports and comments. Reply with one short sentence saying what you "
    "changed, then the complete updated file in a single fenced code block. Never shorten the file, never leave out "
    "unchanged parts, and never add placeholders such as '... rest of file'."
)


class AIProblem(Exception):
    def __init__(self, p: dict, status: int = 400):
        super().__init__(p["what"])
        self.problem = p
        self.status = status


# ---------- settings ----------

def settings_path() -> Path:
    return Path(config_dir()) / "ai.json"


def load_settings() -> dict:
    try:
        raw = json.loads(settings_path().read_text(encoding="utf8"))
        if isinstance(raw, dict) and isinstance(raw.get("providers"), dict):
            return raw
    except (OSError, ValueError):
        pass
    return {"active": None, "providers": {}}


def save_settings(s: dict) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=2), encoding="utf8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def _hint(key: str) -> str:
    return f"…{key[-4:]}" if len(key) >= 8 else "saved"


def public_settings() -> dict:
    """What the window may see: everything except the keys themselves."""
    s = load_settings()
    out = []
    for pid, p in PROVIDERS.items():
        mine = s["providers"].get(pid, {})
        key = mine.get("key") or ""
        ready = bool(key) or p.get("noKey") or (p.get("optionalKey") and bool(mine.get("baseUrl")))
        out.append({
            "id": pid, "label": p["label"], "tier": p["tier"], "keyUrl": p["keyUrl"], "models": p["models"],
            "needsKey": not p.get("noKey") and not p.get("optionalKey"),
            "model": mine.get("model") or (p["models"][0] if p["models"] else ""),
            "baseUrl": mine.get("baseUrl") or p["base"], "editableUrl": pid in ("ollama", "custom"),
            "hasKey": bool(key), "keyHint": _hint(key) if key else "", "ready": bool(ready),
        })
    return {"active": s.get("active"), "providers": out}


def update_settings(provider: str, api_key: Optional[str] = None, model: Optional[str] = None, base_url: Optional[str] = None,
                    clear_key: bool = False, make_active: bool = False) -> dict:
    if provider not in PROVIDERS:
        raise AIProblem(problem("That provider is not supported", [f"Got {provider!r}"], "Pick one from the list."))
    s = load_settings()
    mine = dict(s["providers"].get(provider, {}))
    if clear_key:
        mine.pop("key", None)
    elif api_key is not None and api_key.strip():
        mine["key"] = api_key.strip()
    if model is not None:
        mine["model"] = model.strip()
    if base_url is not None and provider in ("ollama", "custom"):
        url = base_url.strip().rstrip("/")
        if url and not re.match(r"^https?://", url):
            raise AIProblem(problem("That address does not look right", [url], "Use a full address such as http://localhost:11434/v1."))
        mine["baseUrl"] = url
    s["providers"][provider] = mine
    if make_active:
        s["active"] = provider
    save_settings(s)
    return public_settings()


def _resolve(provider: Optional[str]) -> tuple:
    s = load_settings()
    pid = provider or s.get("active")
    if not pid:
        raise AIProblem(problem("No AI model is set up yet", ["Codeville needs a model to edit files"],
                                "Open Extensions, AI models, pick a provider, paste its key and choose Use this one."))
    if pid not in PROVIDERS:
        raise AIProblem(problem("That provider is not supported", [f"Got {pid!r}"], "Pick one from the list in Extensions."))
    p, mine = PROVIDERS[pid], s["providers"].get(pid, {})
    key = mine.get("key") or ""
    if not key and not p.get("noKey") and not p.get("optionalKey"):
        raise AIProblem(problem(f"{p['label']} has no API key", ["The key has not been added yet"],
                                f"Get a key at {p['keyUrl']}, then paste it in Extensions, AI models."))
    model = mine.get("model") or (p["models"][0] if p["models"] else "")
    base = mine.get("baseUrl") or p["base"]
    if not model:
        raise AIProblem(problem("No model is chosen", [f"{p['label']} needs a model name"], "Type the model name in Extensions, AI models."))
    if not base:
        raise AIProblem(problem("No address is set", ["A custom provider needs its API address"], "Add the address in Extensions, AI models."))
    return pid, p, key, model, base


# ---------- calls ----------

def _openai_chat(base: str, key: str, model: str, system: str, user: str, label: str) -> str:
    body = json.dumps({"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    headers = {"content-type": "application/json", "user-agent": "Codeville"}
    if key:
        headers["authorization"] = f"Bearer {key}"
    req = urllib.request.Request(f"{base.rstrip('/')}/chat/completions", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.loads(r.read().decode("utf8"))
    except urllib.error.HTTPError as e:
        detail = _error_text(e)
        raise AIProblem(_http_problem(e.code, label, model, detail), 502) from None
    except urllib.error.URLError as e:
        nxt = "Start Ollama on this computer (ollama serve), then try again." if "localhost" in base or "127.0.0.1" in base else "Check your internet connection and the address, then try again."
        raise AIProblem(problem(f"Could not reach {label}", [str(e.reason)], nxt), 502) from None
    except TimeoutError:
        raise AIProblem(problem(f"{label} took too long to answer", [f"No reply within {TIMEOUT} seconds"], "Try a smaller file or a faster model."), 504) from None
    try:
        msg = data["choices"][0]["message"]
        text = msg.get("content") or ""
        finish = data["choices"][0].get("finish_reason")
    except (KeyError, IndexError, TypeError):
        raise AIProblem(problem(f"{label} sent an answer Codeville could not read", [json.dumps(data)[:300]], "Try another model."), 502) from None
    if finish == "length":
        raise AIProblem(problem("The answer was cut off", [f"{model} hit its output limit before finishing the file"], "Ask for a smaller change, or pick a model with a larger output limit."), 502)
    return text


def _anthropic_chat(key: str, model: str, system: str, user: str) -> str:
    try:
        import anthropic
    except ImportError:
        raise AIProblem(problem("The Anthropic package is missing", ["The backend could not import anthropic"],
                                "Install the backend packages again (pip install -r requirements.txt)."), 500) from None
    client = anthropic.Anthropic(api_key=key, timeout=float(TIMEOUT), max_retries=2)
    args = {"model": model, "max_tokens": 64000, "system": system, "messages": [{"role": "user", "content": user}]}
    try:
        # A whole file can be long, so the answer is streamed and collected.
        if model in _FALLBACK_MODELS:
            with client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **args) as stream:
                msg = stream.get_final_message()
        else:
            with client.messages.stream(**args) as stream:
                msg = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise AIProblem(_http_problem(401, "Anthropic", model, ""), 502) from None
    except anthropic.PermissionDeniedError as e:
        raise AIProblem(_http_problem(403, "Anthropic", model, e.message), 502) from None
    except anthropic.NotFoundError as e:
        raise AIProblem(_http_problem(404, "Anthropic", model, e.message), 502) from None
    except anthropic.RateLimitError as e:
        raise AIProblem(_http_problem(429, "Anthropic", model, e.message), 502) from None
    except anthropic.APIStatusError as e:
        raise AIProblem(_http_problem(e.status_code, "Anthropic", model, e.message), 502) from None
    except anthropic.APIConnectionError:
        raise AIProblem(problem("Could not reach Anthropic", ["No connection to api.anthropic.com"], "Check your internet connection, then try again."), 502) from None
    if msg.stop_reason == "refusal":
        raise AIProblem(problem("Claude declined this request", ["The request was refused by a safety check"], "Rephrase the instruction and try again."), 502)
    if msg.stop_reason == "max_tokens":
        raise AIProblem(problem("The answer was cut off", [f"{model} hit its output limit before finishing the file"], "Ask for a smaller change."), 502)
    return "".join(b.text for b in msg.content if b.type == "text")


def _error_text(e: urllib.error.HTTPError) -> str:
    try:
        raw = e.read().decode("utf8", "replace")
        data = json.loads(raw)
        err = data.get("error", data)
        return (err.get("message") if isinstance(err, dict) else str(err))[:300]
    except Exception:  # noqa: BLE001 - the detail is only a hint
        return ""


def _http_problem(code: int, label: str, model: str, detail: str) -> dict:
    why = [detail] if detail else []
    if code in (401, 403):
        return problem(f"{label} did not accept the API key", why or ["The key is wrong, expired or has no access"], "Paste a new key in Extensions, AI models.")
    if code == 404:
        return problem(f"{label} does not know the model {model}", why, "Pick another model in Extensions, AI models.")
    if code == 429:
        return problem(f"{label} says slow down", why or ["Too many requests, or the free quota is used up"], "Wait a minute and try again, or switch to another provider.")
    if code == 402:
        return problem(f"{label} needs credit on the account", why, "Add credit on the provider's site, or switch to a free provider.")
    return problem(f"{label} answered with an error ({code})", why, "Try again in a moment.")


def chat(provider: Optional[str], system: str, user: str) -> tuple:
    pid, p, key, model, base = _resolve(provider)
    if p["api"] == "anthropic":
        return _anthropic_chat(key, model, system, user), pid, model
    return _openai_chat(base, key, model, system, user, p["label"]), pid, model


def test(provider: Optional[str]) -> dict:
    t0 = time.time()
    text, pid, model = chat(provider, "Reply with the single word OK.", "Say OK.")
    return {"ok": True, "provider": pid, "model": model, "ms": int((time.time() - t0) * 1000), "reply": text.strip()[:40]}


_FENCE = re.compile(r"```[^\n`]*\n(.*?)\n?```", re.S)


def parse_edit(text: str) -> tuple:
    """Splits a reply into (summary, file). The file is the longest fenced block."""
    blocks = _FENCE.findall(text)
    if not blocks:
        raise AIProblem(problem("The model did not send back a file", [text.strip()[:200] or "The reply was empty"], "Try again, or pick a stronger model."), 502)
    body = max(blocks, key=len)
    summary = _FENCE.sub("", text).strip().splitlines()
    return (summary[0].strip() if summary else ""), body


def edit(provider: Optional[str], rel: str, original: str, instruction: str) -> dict:
    if not instruction.strip():
        raise AIProblem(problem("Type what to change", ["The instruction is empty"], "Describe the change, for example: add input validation."))
    if len(original) > MAX_EDIT_CHARS:
        raise AIProblem(problem("This file is too long to edit with AI here", [f"{len(original):,} characters; the limit is {MAX_EDIT_CHARS:,}"],
                                "Ask Claude Code in the Chat instead: it edits large files in place."))
    t0 = time.time()
    user = f"File: {rel}\n\n```\n{original}\n```\n\nInstruction: {instruction.strip()}"
    text, pid, model = chat(provider, SYSTEM, user)
    summary, updated = parse_edit(text)
    if original.endswith("\n") and not updated.endswith("\n"):
        updated += "\n"
    return {"file": rel, "original": original, "updated": updated, "summary": summary, "provider": pid, "model": model,
            "ms": int((time.time() - t0) * 1000), "changed": updated != original}
