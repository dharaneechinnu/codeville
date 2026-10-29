"""Which project the agent tools work on when a call does not name one."""

from __future__ import annotations

import threading
from typing import Optional

_lock = threading.Lock()
_root: Optional[str] = None


def set_root(path: str) -> None:
    global _root
    with _lock:
        _root = path


def get_root() -> Optional[str]:
    with _lock:
        return _root
