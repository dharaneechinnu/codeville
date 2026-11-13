"""The project map a coding agent writes after reading the code.

File names only say so much: a cart kept in `utils.js` is invisible to the name-based tools. An agent that has read the
code knows better. So the app can ask the connected agent (Claude Code) to describe the project in a small file,
`.codeville/map.json`, and the analysis then uses that description instead of its own guesses: the steps of the user
flow become the houses of the town, the agent's entry file becomes each house's door, and every file gets one plain
line saying what it does.

The app never trusts the file blindly: paths it does not know are dropped, and a map with too little left is ignored."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Optional

from . import steps as S

MAP_FILE = ".codeville/map.json"
STYLES = {"shop": "an online store", "apartment": "a social app", "library": "a blog or content site", "office": "a dashboard or team tool", "workshop": "anything else"}
LAYERS = ("frontend", "backend", "database", "tests")
MAX_STEPS = 10
MAX_PROMPT_FILES = 500

EXAMPLE = {
    "version": 1,
    "kind": "Online store",
    "summary": "Shoppers browse products, fill a cart and pay.",
    "style": "shop",
    "steps": [
        {"name": "Cart", "about": "Add items, change quantity, see the total.", "entry": "frontend/src/cart/Cart.tsx",
         "files": ["frontend/src/cart/Cart.tsx", "backend/store/cart.py", "backend/tests/test_cart.py"]},
    ],
    "files": {"backend/store/cart.py": "Adds and removes cart lines and works out the total."},
}


def map_prompt(files: list) -> str:
    """What the app asks the agent to do. The agent reads the code and writes the map file; it changes nothing else."""
    paths = [f["path"] for f in files][:MAX_PROMPT_FILES]
    styles = "\n".join(f'  - "{k}": {v}' for k, v in STYLES.items())
    return f"""Codeville draws this project as a town so a new person can understand it. Read the code and describe the project in one file. Do not change any other file.

Write `{MAP_FILE}` (create the folder) as JSON in exactly this shape:

{json.dumps(EXAMPLE, indent=2)}

Rules:
- Read the files before you decide. Go by what the code does, not by its file name.
- "kind": what kind of app this is, in two or three plain words.
- "summary": one sentence a non-programmer would understand.
- "style": the look of the town. One of:
{styles}
- "steps": the things a user does in this app, in the order they meet them. Between 3 and {MAX_STEPS} steps. For a tool with no screens, use the stages the data goes through.
  - "name": two words at most. "about": one plain sentence.
  - "files": every file that does this step: screens, server code and tests together. Put each file in one step only, the one it matters to most. Leave shared helpers, config and setup out of every step.
  - "entry": the one file a user reaches first in this step, usually its page or screen, or its routes when there is no screen. It must be in "files".
- "files": for every file you placed in a step, one line of at most twelve words saying what it does, in plain words.
- Use only these paths, spelled exactly:

{chr(10).join(paths)}

When the file is written, reply with one line: the kind of app and how many steps you found."""


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "step"


def read_map(root: Path) -> Optional[dict]:
    try:
        raw = json.loads((root / MAP_FILE).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return None
    return raw if isinstance(raw, dict) else None


def check_map(raw: object, files: list) -> tuple:
    """Cleans a map against the real project. Returns (map, "") when it can be used, or (None, why not)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("steps"), list):
        return None, 'The map needs a "steps" list.'
    layer = {f["path"]: f["layer"] for f in files}
    seen: set = set()
    ids: Counter = Counter()
    out_steps = []
    unknown = 0
    for st in raw["steps"][:MAX_STEPS]:
        if not isinstance(st, dict) or not str(st.get("name", "")).strip():
            continue
        paths = []
        for p in st.get("files") or []:
            p = str(p).replace("\\", "/").lstrip("./")
            if p not in layer:
                unknown += 1
            elif p not in seen and layer[p] != "database":  # database files keep their own building
                seen.add(p)
                paths.append(p)
        if not paths:
            continue
        name = str(st["name"]).strip()[:40]
        sid = _slug(name)
        ids[sid] += 1
        if ids[sid] > 1:
            sid = f"{sid}-{ids[sid]}"
        entry = str(st.get("entry") or "").replace("\\", "/").lstrip("./")
        out_steps.append({"id": sid, "name": name, "about": str(st.get("about") or "").strip()[:200], "files": paths, "entry": entry if entry in paths else ""})
    if len(out_steps) < 2:
        why = "Fewer than two steps list files of this project."
        return None, why + (f" {unknown} paths in the map are not files of this project." if unknown else "")
    notes = {}
    if isinstance(raw.get("files"), dict):
        for p, text in raw["files"].items():
            p = str(p).replace("\\", "/").lstrip("./")
            if p in layer and isinstance(text, str) and text.strip():
                notes[p] = text.strip()[:140]
    style = raw.get("style") if raw.get("style") in STYLES else None
    return {
        "kind": str(raw.get("kind") or "").strip()[:40], "summary": str(raw.get("summary") or "").strip()[:240],
        "style": style, "steps": out_steps, "notes": notes, "dropped": unknown,
    }, ""


def load_map(root: Path, files: list) -> Optional[dict]:
    raw = read_map(root)
    return check_map(raw, files)[0] if raw is not None else None


def features_from_map(files: list, amap: dict) -> list:
    """The agent's steps become the features (the houses), in its order. What it left out is grouped the usual way."""
    by_path = {f["path"]: f for f in files}
    used = {p for st in amap["steps"] for p in st["files"]}
    out = []
    for st in amap["steps"]:
        feat = S._feature("feature", st["name"], [by_path[p] for p in st["files"]])
        feat["id"] = st["id"]
        out.append(feat)
    taken = {f["id"] for f in out}
    for feat in S.find_features([f for f in files if f["path"] not in used]):
        while feat["id"] in taken:
            feat["id"] += "-other"
        taken.add(feat["id"])
        out.append(feat)
    return out


def flow_from_map(amap: dict, files: list) -> dict:
    layer = {f["path"]: f["layer"] for f in files}
    steps = []
    for st in amap["steps"]:
        counts = Counter(layer[p] for p in st["files"])
        steps.append({
            "id": st["id"], "name": st["name"], "about": st["about"], "found": True, "key": False, "entry": st["entry"],
            "files": [{"path": p, "layer": layer[p]} for p in sorted(st["files"])],
            "layers": {k: counts.get(k, 0) for k in LAYERS}, "features": [st["id"]],
        })
    used = {p for st in amap["steps"] for p in st["files"]}
    rest = Counter()
    for f in files:
        if f["path"] not in used:
            rest["Database" if f["layer"] == "database" else "Shared code"] += 1
    return {
        "template": {"id": "agent", "name": amap["kind"] or "This app", "examples": [], "about": amap["summary"]},
        "steps": steps, "found": len(steps), "total": len(steps), "source": "agent", "style": amap["style"],
        "others": [{"id": _slug(k), "name": k, "files": n} for k, n in rest.items()],
    }


def save_map(root: Path, raw: object, files: list) -> dict:
    """Checks a map an agent sent and, when it can be used, writes it. Raises ValueError saying what to fix."""
    amap, why = check_map(raw, files)
    if amap is None:
        raise ValueError(why)
    target = root / MAP_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(raw, indent=2), encoding="utf8")
    return {"saved": MAP_FILE, "steps": len(amap["steps"]), "files": sum(len(s["files"]) for s in amap["steps"]), "dropped": amap["dropped"]}
