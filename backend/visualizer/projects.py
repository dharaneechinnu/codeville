"""Starting a project: a new folder from a small template, or a clone of a repository.
A failure comes back as a Problem: what broke, why, and what is next."""

from __future__ import annotations

import re
from pathlib import Path

from .events import problem
from .gitops import GitProblem, _git

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

_NODE_PKG = """{{
  "name": "{name}",
  "version": "0.1.0",
  "private": true,
  "scripts": {{ "test": "node --test tests" }}
}}
"""

TEMPLATES: dict[str, dict] = {
    "empty": {
        "title": "Empty",
        "about": "Just a folder and a README.",
        "files": {"README.md": "# {name}\n"},
    },
    "node": {
        "title": "Node app with tests",
        "about": "A small JavaScript app. `npm test` runs node's own test runner.",
        "files": {
            "package.json": _NODE_PKG,
            "src/index.js": "function add(a, b) {{\n  return a + b;\n}}\n\nmodule.exports = {{ add }};\n",
            "tests/index.test.js": "const test = require('node:test');\nconst assert = require('node:assert');\nconst {{ add }} = require('../src/index.js');\n\ntest('adds numbers', () => {{\n  assert.strictEqual(add(1, 2), 3);\n}});\n",
            "README.md": "# {name}\n\nRun `npm test`.\n",
            ".gitignore": "node_modules/\n",
        },
    },
    "python": {
        "title": "Python app with tests",
        "about": "A small Python app. `python -m unittest` runs the tests.",
        "files": {
            "app/__init__.py": "",
            "app/main.py": "def add(a, b):\n    return a + b\n",
            "tests/test_main.py": "import unittest\n\nfrom app.main import add\n\n\nclass AddTest(unittest.TestCase):\n    def test_adds_numbers(self):\n        self.assertEqual(add(1, 2), 3)\n\n\nif __name__ == '__main__':\n    unittest.main()\n",
            "README.md": "# {name}\n\nRun `python -m unittest`.\n",
            ".gitignore": "__pycache__/\n.venv/\n",
        },
    },
}


def list_templates() -> list[dict]:
    return [{"id": k, "title": v["title"], "about": v["about"]} for k, v in TEMPLATES.items()]


def _check_name(name: str) -> None:
    if not NAME_RE.match(name):
        raise GitProblem(problem("That project name cannot be used", ["Use letters, numbers, dots, dashes and underscores, up to 64 characters"], "Pick a simpler name, for example my-shop."))


def _check_parent(parent: str) -> Path:
    p = Path(parent).expanduser().resolve()
    if not p.is_dir():
        raise GitProblem(problem("That folder does not exist", [str(p)], "Choose an existing folder to put the project in."))
    return p


def create(parent: str, name: str, template: str) -> str:
    """Makes the folder and its files, then starts git. Returns the project folder."""
    _check_name(name)
    base = _check_parent(parent)
    if template not in TEMPLATES:
        raise GitProblem(problem("That template does not exist", [f"Unknown template: {template}"], "Pick one from the list."))
    target = base / name
    if target.exists():
        raise GitProblem(problem("A folder with that name already exists", [str(target)], "Pick another name, or open that folder instead."))
    target.mkdir()
    for rel, body in TEMPLATES[template]["files"].items():
        f = target / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body.format(name=name), encoding="utf-8", newline="\n")
    _git(str(target), "init", timeout=30)
    return str(target)


def clone(parent: str, url: str) -> str:
    """Copies a repository next to the user's other projects. Returns the project folder."""
    url = url.strip()
    if not re.match(r"^(https://|git@|ssh://)", url):
        raise GitProblem(problem("That address is not a repository link", [f"Got: {url[:80]}"], "Paste a link that starts with https:// or git@."))
    base = _check_parent(parent)
    name = re.sub(r"\.git$", "", url.rstrip("/").split("/")[-1].split(":")[-1])
    _check_name(name)
    target = base / name
    if target.exists():
        raise GitProblem(problem("A folder with that name already exists", [str(target)], "Open that folder instead, or choose another place."))
    r = _git(str(base), "clone", "--", url, name, timeout=600)
    if r.returncode != 0:
        err = (r.stderr or "").strip().splitlines()
        last = err[-1] if err else "git clone failed"
        denied = any(k in r.stderr.lower() for k in ("authentication", "permission denied", "could not read username", "not found"))
        nxt = "Check the link and that you can open it. Private repositories need git login on this computer." if denied else "Check your network and the link, then try again."
        raise GitProblem(problem("Could not copy that repository", [last], nxt))
    return str(target)
