"""The live stream: a bounded history in memory, subscribers that get every event, and a copy in the database."""

from __future__ import annotations

import logging
import queue
import threading
from collections import deque
from typing import Callable, Optional

from .events import stamp

log = logging.getLogger(__name__)


class EventHub:
    def __init__(self, max_events: int = 2000, persist: bool = True) -> None:
        self._history: deque[dict] = deque(maxlen=max_events)
        self._lock = threading.Lock()
        self._queues: set[queue.Queue] = set()
        self._listeners: list[Callable[[dict], None]] = []
        self._persist = persist

    def push(self, event: dict) -> dict:
        e = stamp(event)
        with self._lock:
            self._history.append(e)
            queues = list(self._queues)
            listeners = list(self._listeners)
        if self._persist:
            self._save(e)
        for q in queues:
            q.put(("message", e))
        for fn in listeners:
            try:
                fn(e)
            except Exception:  # one broken listener must not stop the others
                log.exception("event listener failed")
        return e

    def push_many(self, events: list) -> list:
        return [self.push(e) for e in events]

    def load_from_db(self, n: int = 500) -> int:
        """After a restart, bring back the latest saved events so the history is not empty."""
        from .models import Event

        rows = list(Event.objects.order_by("-ts")[:n])
        rows.reverse()
        with self._lock:
            for row in rows:
                self._history.append(row.payload)
        return len(rows)

    def output(self, payload: dict) -> None:
        """A terminal line. It goes to live viewers only and is not kept."""
        with self._lock:
            queues = list(self._queues)
        for q in queues:
            q.put(("output", payload))

    def recent(self, n: int = 200) -> list:
        with self._lock:
            return list(self._history)[-n:]

    def find(self, predicate: Callable[[dict], bool], n: int = 500) -> Optional[dict]:
        for e in reversed(self.recent(n)):
            if predicate(e):
                return e
        return None

    def add_listener(self, fn: Callable[[dict], None]) -> None:
        with self._lock:
            self._listeners.append(fn)

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._queues.add(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._queues.discard(q)

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._history)

    @staticmethod
    def _save(e: dict) -> None:
        try:
            from .models import Event

            Event.objects.update_or_create(
                id=e["id"],
                defaults={"ts": int(e["ts"]), "type": e["type"], "source": e["source"], "session_id": e.get("sessionId") or "", "payload": e},
            )
        except Exception:  # a full disk or a locked database must never stop the live stream
            log.exception("could not save event")


hub = EventHub()
