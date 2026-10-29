import json

import pytest

from visualizer.analysis import STEP_LABELS, run_analysis


def write(root, rel, text="x\n"):
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text, encoding="utf-8")


@pytest.fixture
def portal(tmp_path):
    write(tmp_path, "README.md", "# Law Portal\n\nBadge text\n\n## What it does\nA portal for matters and clients.\n")
    write(tmp_path, "frontend/package.json", json.dumps({"dependencies": {"react": "1", "@tanstack/react-query": "1", "stripe": "1"}, "devDependencies": {"vite": "1"}}))
    write(tmp_path, "backend/requirements.txt", "fastapi>=0.1\nsqlalchemy>=2\nalembic\npsycopg[binary]>=3\npgvector\nlangchain-anthropic\n")
    write(tmp_path, ".env.example", "# DATABASE_URL=postgresql://x\nOPENAI_API_KEY=\n")
    for rel in [
        "frontend/src/features/matters/MatterList.tsx", "frontend/src/features/matters/MatterPage.tsx",
        "backend/app/api/matters.py", "backend/app/services/matters.py", "backend/tests/test_matters.py",
        "frontend/src/features/clients/ClientsPage.tsx", "backend/app/api/clients.py",
        "backend/alembic/versions/a1_create_matters.py", "backend/app/models/matter.py", "frontend/src/main.tsx",
        "backend/app/main.py",
    ]:
        write(tmp_path, rel)
    return tmp_path


def test_the_agent_reads_identity_stack_layers_and_features(portal):
    a = run_analysis(str(portal))
    assert a["title"] == "Law Portal" and a["summary"] == "A portal for matters and clients."
    assert a["kind"] == "Full-stack web app"
    assert {"React", "React Query", "Vite"} <= set(a["stack"]["frontend"])
    assert {"FastAPI"} <= set(a["stack"]["backend"])
    assert {"PostgreSQL", "Alembic", "SQLAlchemy", "pgvector"} <= set(a["stack"]["database"])
    assert {"Stripe", "OpenAI", "Anthropic Claude"} <= set(a["stack"]["services"])
    assert a["layers"] == {"frontend": 4, "backend": 4, "database": 2, "tests": 1}
    by = {f["name"]: f for f in a["features"]}
    assert by["Matter"]["layers"] == {"frontend": 2, "backend": 2, "database": 0, "tests": 1}
    assert by["Client"]["layers"]["frontend"] == 1 and by["Client"]["layers"]["backend"] == 1
    assert by["Database"]["kind"] == "database" and len(by["Database"]["files"]) == 2
    everything = [f["path"] for feat in a["features"] for f in feat["files"]]
    assert len(set(everything)) == len(everything) == a["totalFiles"]


def test_the_agent_reports_each_step_while_it_works(portal):
    seen = []
    a = run_analysis(str(portal), seen.append)
    names = [s[0] for s in STEP_LABELS]
    assert [e["step"] for e in seen if e["status"] == "running"] == names
    assert [e["step"] for e in seen if e["status"] == "done"] == names
    assert all(e["type"] == "analysis.step" and e["source"] == "app" for e in seen)
    assert [s["step"] for s in a["steps"]] == names


def test_an_empty_or_plain_folder_still_gets_a_report(tmp_path):
    a = run_analysis(str(tmp_path))
    assert a["kind"] == "Software project" and a["features"] == [] and a["totalFiles"] == 0


@pytest.mark.django_db
def test_analyze_endpoint_returns_the_report_and_streams_steps(auth, portal):
    from visualizer.hub import hub

    r = auth.post("/api/analyze", {"path": str(portal)}, format="json")
    assert r.status_code == 200
    assert r.json()["stack"]["frontend"] and r.json()["steps"]
    assert any(e["type"] == "analysis.step" for e in hub.recent(100))


def test_agents_can_call_the_analysis_tools(auth, portal):
    r = auth.post("/api/tools/analyze_project", {"path": str(portal)}, format="json")
    assert r.status_code == 200 and r.json()["kind"] == "Full-stack web app"
    r = auth.post("/api/tools/detect_stack", {"path": str(portal)}, format="json")
    assert "FastAPI" in r.json()["backend"]
    r = auth.post("/api/tools/find_features", {"path": str(portal)}, format="json")
    assert any(f["name"] == "Matter" for f in r.json()["features"])


@pytest.fixture
def wired(tmp_path):
    write(tmp_path, "frontend/package.json", json.dumps({"dependencies": {"react": "1"}}))
    write(tmp_path, "backend/requirements.txt", "fastapi\nsqlalchemy\nstripe\n")
    write(tmp_path, "backend/app/models/matter.py", "from sqlalchemy import Column\n")
    write(tmp_path, "backend/app/services/matters.py", "from app.models.matter import Matter\nimport stripe\n")
    write(tmp_path, "backend/app/api/matters.py", 'from fastapi import APIRouter\nfrom app.services import matters\nrouter = APIRouter(prefix="/matters")\n@router.get("")\ndef x(): ...\n')
    write(tmp_path, "backend/app/api/clients.py", "from app.services.matters import x\n")
    write(tmp_path, "frontend/src/features/matters/MatterList.tsx", "import { api } from '../../services/api'\nconst r = await fetch('/api/matters')\n")
    write(tmp_path, "frontend/src/features/clients/ClientsPage.tsx", "import { Row } from '../matters/MatterList'\n")
    write(tmp_path, "frontend/src/services/api.ts", "export const api = 1\n")
    write(tmp_path, "backend/tests/test_matters.py", "from app.services.matters import x\n")
    return tmp_path


def test_the_agent_traces_how_buildings_connect(wired):
    a = run_analysis(str(wired))
    links = {(e["from"], e["to"], e["kind"]) for e in a["connections"]}
    # the frontend calls the route the backend defines
    assert ("matter:frontend", "matter:backend", "calls") in links
    # backend code that uses the ORM stores data in the database, and imports models
    assert any(k == "stores" and t == "database:database" and f.startswith("matter:") for f, t, k in links)
    # an outside service is used by the file that imports it
    assert ("matter:backend", "svc-Stripe:backend", "uses") in links
    # one feature imports another
    assert ("client:frontend", "matter:frontend", "imports") in links
    # tests point at what they cover
    assert ("matter:tests", "matter:backend", "tests") in links
    # nothing points out of the database or at itself
    assert not any(f.startswith("database:") or f == t for f, t, _ in links)


def test_the_connections_tool_is_available_to_agents(auth, wired):
    r = auth.post("/api/tools/find_connections", {"path": str(wired)}, format="json")
    assert r.status_code == 200 and r.json()["total"] > 0 and r.json()["links"][0].keys() >= {"from", "to", "kind", "weight"}


@pytest.fixture
def mixed(tmp_path):
    write(tmp_path, "frontend/package.json", json.dumps({"scripts": {"dev": "vite", "build": "vite build", "test": "echo \"Error: no test specified\" && exit 1"}}))
    write(tmp_path, "backend/pytest.ini", "[pytest]\n")
    write(tmp_path, "backend/.venv/Scripts/python.exe", "x")
    write(tmp_path, "backend/app/main.py", "x = 1\n")
    write(tmp_path, "backend/tests/test_access.py", "def test_login():\n    pass\n\nasync def test_logout():\n    pass\n")
    write(tmp_path, "frontend/src/cart.test.ts", "describe('cart', () => {\n  it('adds an item', () => {})\n  test.skip(\"removes an item\", () => {})\n})\n")
    return tmp_path


def test_the_agent_finds_each_folders_own_commands(mixed):
    a = run_analysis(str(mixed))
    cmds = {(c["kind"], c["cwd"]): c["command"] for c in a["commands"]}
    assert ("test", "backend") in cmds and cmds[("test", "backend")].endswith("-m pytest -q") and ".venv" in cmds[("test", "backend")]
    assert cmds[("build", "frontend")] == "npm run build"
    # the placeholder "no test specified" script is not a real test command
    assert ("test", "frontend") not in cmds


def test_the_agent_lists_the_test_cases_written_in_the_code(mixed):
    a = run_analysis(str(mixed))
    found = {(t["file"], t["name"], t["line"]): t["cwd"] for t in a["tests"]}
    assert found[("backend/tests/test_access.py", "test_login", 1)] == "backend"
    assert ("backend/tests/test_access.py", "test_logout", 4) in found
    assert ("frontend/src/cart.test.ts", "adds an item", 2) in found and ("frontend/src/cart.test.ts", "removes an item", 3) in found


def test_a_run_that_never_started_says_why_and_what_to_do():
    from visualizer.parsers.test_output import why_not_run

    why, nxt = why_not_run(["npm error code ENOENT", "npm error enoent Could not read package.json: Error: ENOENT"])
    assert "no package.json" in why.lower() and "frontend" in nxt
    why, _ = why_not_run(["ModuleNotFoundError: No module named 'psycopg'"])
    assert "package the tests need is missing" in why
    why, nxt = why_not_run(["sqlalchemy.exc.OperationalError: connection refused"])
    assert "database" in why and "PostgreSQL" in nxt
    why, _ = why_not_run(["something odd", "error: boom happened"])
    assert why == "error: boom happened"


@pytest.mark.django_db
def test_commands_and_tests_are_available_to_agents(auth, mixed):
    r = auth.post("/api/tools/find_commands", {"path": str(mixed)}, format="json")
    assert r.status_code == 200 and any(c["kind"] == "test" for c in r.json()["commands"])
    r = auth.post("/api/tools/find_tests", {"path": str(mixed)}, format="json")
    assert r.status_code == 200 and r.json()["total"] >= 4
