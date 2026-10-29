import json
import os
import tempfile
from pathlib import Path

import pytest

# Tests use their own home folder, so they never touch the real config or token.
HOME = tempfile.mkdtemp(prefix="cv-home-")
os.environ["CV_HOME"] = HOME
TOKEN = "a" * 32
Path(HOME, "config.json").write_text(json.dumps({"port": 4317, "token": TOKEN}))


@pytest.fixture(autouse=True)
def _no_persist():
    """Events are kept in memory during tests. One test turns saving on to check it."""
    from visualizer.hub import hub

    old = hub._persist
    hub._persist = False
    yield
    hub._persist = old


@pytest.fixture
def token() -> str:
    return TOKEN


@pytest.fixture
def client():
    from rest_framework.test import APIClient

    return APIClient(HTTP_HOST="127.0.0.1")


@pytest.fixture
def auth(client):
    client.credentials(HTTP_X_CV_TOKEN=TOKEN)
    return client
