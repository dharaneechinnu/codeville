"""The analysis agent's `match_template` tool. Many projects are the same kind of app: every online store has a
catalog, a cart, a checkout and orders, whether it sells books or delivers groceries in ten minutes. A template is that
shared shape, written down once: the steps a user walks through, in order, and the words that name each step in code.

The tool picks the template that fits a project best and says which of the project's files do each step, and which
steps the project does not have yet. A project that fits no template gets the general one, which follows its layers.

Templates are written by hand, here. To teach the app a new kind of project, add one to TEMPLATES."""

from __future__ import annotations

from collections import Counter

from .steps import _singular, _tokens

LAYERS = ("frontend", "backend", "database", "tests")
MIN_SHARE = 0.15

AUTH = ["auth", "login", "logout", "signup", "signin", "register", "session", "password", "otp", "oauth", "jwt"]
NOTIFY = ["notification", "notify", "email", "mail", "sms", "push"]


def _step(id: str, name: str, about: str, words: list, key: bool = False) -> dict:
    return {"id": id, "name": name, "about": about, "words": words, "key": key}


# Each template: who it is for, the steps in the order a user meets them, and how many key steps a project must have
# before the template is believed. A key step is one that only this kind of app has.
TEMPLATES = [
    {
        "id": "commerce",
        "name": "Online store",
        "examples": ["Amazon", "Flipkart", "Zepto", "Blinkit"],
        "about": "People browse things to buy, fill a cart, pay, and wait for the order.",
        "need": 2,
        "steps": [
            _step("signin", "Sign in", "The shopper creates an account or logs in.", AUTH),
            _step("browse", "Browse", "The home page and the list of things to buy.", ["product", "catalog", "category", "listing", "inventory", "item", "home", "banner", "collection"], key=True),
            _step("search", "Search", "Find a product by name or filter.", ["search", "filter", "suggest"]),
            _step("cart", "Cart", "Add items, change quantity, see the total.", ["cart", "basket", "bag", "pricing", "price", "coupon", "discount"], key=True),
            _step("pay", "Checkout & pay", "Enter the address and pay.", ["checkout", "payment", "pay", "stripe", "razorpay", "paypal", "billing", "address"], key=True),
            _step("orders", "Orders & delivery", "The order is placed, packed and tracked to the door.", ["order", "delivery", "shipping", "shipment", "tracking", "rider", "slot", "fulfilment", "fulfillment"], key=True),
            _step("notify", "Notify", "Emails and messages about the order.", NOTIFY),
        ],
    },
    {
        "id": "social",
        "name": "Social app",
        "examples": ["Instagram", "X", "Reddit"],
        "about": "People post, follow each other, react and talk.",
        "need": 2,
        "steps": [
            _step("signin", "Sign in", "The person creates an account or logs in.", AUTH),
            _step("feed", "Feed", "The stream of posts a person sees first.", ["feed", "timeline", "explore", "trending"], key=True),
            _step("post", "Post", "Write a post or upload a photo.", ["post", "story", "upload", "media", "tweet"]),
            _step("react", "React", "Like, comment and share.", ["like", "comment", "reaction", "share", "vote"], key=True),
            _step("profile", "Profile & follow", "A person's page and who they follow.", ["profile", "follow", "follower", "friend"], key=True),
            _step("chat", "Chat", "Private messages.", ["chat", "message", "conversation", "inbox"], key=True),
            _step("notify", "Notify", "Alerts about new activity.", NOTIFY),
        ],
    },
    {
        "id": "content",
        "name": "Blog or content site",
        "examples": ["Medium", "a company blog", "a docs site"],
        "about": "Writers publish articles and readers find and read them.",
        "need": 1,
        "steps": [
            _step("home", "Home", "The front page with the newest articles.", ["home", "landing"]),
            _step("read", "Articles", "The list of articles and the page for one.", ["post", "article", "blog", "story", "page"], key=True),
            _step("search", "Search & tags", "Find an article by word or topic.", ["search", "tag", "category", "topic"]),
            _step("comment", "Comments", "Readers reply to an article.", ["comment", "reply"]),
            _step("write", "Write & publish", "The editor where writers create articles.", ["editor", "admin", "cms", "draft", "publish"]),
            _step("signin", "Sign in", "Writers and readers log in.", AUTH),
        ],
    },
    {
        "id": "saas",
        "name": "Dashboard app",
        "examples": ["Notion", "Jira", "an admin panel"],
        "about": "A team signs in, works on its records, and reads reports.",
        "need": 2,
        "steps": [
            _step("signin", "Sign in", "The person logs in to their workspace.", AUTH),
            _step("dashboard", "Dashboard", "The first screen: what needs attention.", ["dashboard", "overview"], key=True),
            _step("team", "Team & roles", "Who is in the workspace and what they may do.", ["team", "member", "role", "permission", "invite", "workspace", "organization", "tenant"], key=True),
            _step("reports", "Reports", "Charts and numbers about the work.", ["report", "analytics", "chart", "metric"], key=True),
            _step("settings", "Settings", "Preferences for the person and the workspace.", ["setting", "preference"], key=True),
            _step("billing", "Plan & billing", "The plan the team pays for.", ["billing", "subscription", "invoice"], key=True),
            _step("notify", "Notify", "Emails and alerts.", NOTIFY),
        ],
    },
]

GENERAL = {
    "id": "general",
    "name": "General app",
    "examples": [],
    "about": "No known kind of app matched, so this follows the layers: what people see, the logic behind it, and where data is kept.",
}
GENERAL_STEPS = [
    ("frontend", "Screens", "What people see and click."),
    ("backend", "Logic", "The code that does the work behind the screens."),
    ("database", "Data", "Where information is kept."),
    ("tests", "Tests", "The checks that the rest still works."),
]


def _hits(path: str, words: set) -> int:
    """How strongly a file's path names a step. The file's own name counts more than the folders above it."""
    tokens = [_singular(t) for t in _tokens(path)]
    folders = len(path.split("/")) - 1
    stem_from = len([t for seg in path.split("/")[:folders] for t in _tokens(seg + "/x")[:-1]])
    score = 0
    for i, t in enumerate(tokens):
        if t in words:
            score += 3 if i >= stem_from else 1
    return score


def _fit(template: dict, files: list, owner: dict) -> dict:
    """Sorts the project's files into the template's steps. A file goes to the one step its path names most strongly."""
    wordsets = [set(s["words"]) for s in template["steps"]]
    placed: list = [[] for _ in template["steps"]]
    for f in files:
        scores = [_hits(f["path"], w) for w in wordsets]
        best = max(scores) if scores else 0
        if best > 0:
            placed[scores.index(best)].append(f)
    steps = []
    for s, got in zip(template["steps"], placed):
        got.sort(key=lambda f: f["path"])
        layers = Counter(f["layer"] for f in got)
        features = [fid for fid, _ in Counter(owner[f["path"]] for f in got if f["path"] in owner).most_common()]
        steps.append({
            "id": s["id"], "name": s["name"], "about": s["about"], "found": bool(got), "key": s["key"],
            "files": [{"path": f["path"], "layer": f["layer"]} for f in got],
            "layers": {k: layers.get(k, 0) for k in LAYERS}, "features": features,
        })
    return {"steps": steps, "keys": sum(1 for s in steps if s["key"] and s["found"]), "found": sum(1 for s in steps if s["found"])}


def match_template(features: list) -> dict:
    """Returns {template, steps, found, total, others}: the kind of app this is, and its user flow mapped onto the code."""
    files = [f for feat in features for f in feat["files"]]
    owner = {f["path"]: feat["id"] for feat in features for f in feat["files"]}
    best, best_fit = None, None
    for t in TEMPLATES:
        fit = _fit(t, files, owner)
        # A template is believed only when enough of its own steps are there, and those steps hold a real share of the
        # project. One file called settings.py does not make a dashboard app.
        covered = sum(len(s["files"]) for s in fit["steps"])
        if fit["keys"] < t["need"] or fit["found"] < 3 or covered < MIN_SHARE * len(files):
            continue
        if best_fit is None or (fit["keys"], fit["found"]) > (best_fit["keys"], best_fit["found"]):
            best, best_fit = t, fit
    if best is None or best_fit is None:
        return _general(features, files, owner)
    used = {f["path"] for s in best_fit["steps"] for f in s["files"]}
    return {
        "template": {k: best[k] for k in ("id", "name", "examples", "about")},
        "steps": best_fit["steps"], "found": best_fit["found"], "total": len(best_fit["steps"]),
        "others": _others(features, used),
    }


def _others(features: list, used: set) -> list:
    """The parts of the project that are not a step of the flow: shared code, the app shell and so on."""
    out = []
    for feat in features:
        rest = [f["path"] for f in feat["files"] if f["path"] not in used]
        if rest:
            out.append({"id": feat["id"], "name": feat["name"], "files": len(rest)})
    return out


def _general(features: list, files: list, owner: dict) -> dict:
    steps = []
    for layer, name, about in GENERAL_STEPS:
        got = sorted((f for f in files if f["layer"] == layer), key=lambda f: f["path"])
        feats = [fid for fid, _ in Counter(owner[f["path"]] for f in got).most_common()]
        steps.append({
            "id": layer, "name": name, "about": about, "found": bool(got), "key": False,
            "files": [{"path": f["path"], "layer": f["layer"]} for f in got[:60]],
            "layers": {k: (len(got) if k == layer else 0) for k in LAYERS}, "features": feats,
        })
    return {"template": dict(GENERAL), "steps": steps, "found": sum(1 for s in steps if s["found"]), "total": len(steps), "others": []}


def list_templates() -> list:
    """The templates the app knows, for people and agents who want to see or extend them."""
    return [{"id": t["id"], "name": t["name"], "examples": t["examples"], "about": t["about"], "steps": [s["name"] for s in t["steps"]]} for t in TEMPLATES]
