"""Starts the Codeville backend on this computer only. The Windows app runs this; so can you."""

from __future__ import annotations

import argparse
import os
import socket
import sys

# The Python that ships with the installer does not add this script's folder to its path. Do it here.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import django  # noqa: E402


def free_port(start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit(f"No free port between {start} and {start + 19}")


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cv_backend.settings")
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    django.setup()
    from django.core.management import call_command

    from visualizer.config import config_path, load_config, save_config

    call_command("migrate", verbosity=0, interactive=False)
    from visualizer.hub import hub

    hub.load_from_db()
    cfg = load_config()
    wanted = args.port or cfg["port"]
    port = free_port(wanted)
    if port != cfg["port"]:
        save_config({**cfg, "port": port})

    from cv_backend.wsgi import application
    from waitress import serve

    print(f"Codeville backend: http://127.0.0.1:{port}", flush=True)
    print(f"Config (port and token): {config_path()}", flush=True)
    serve(application, host="127.0.0.1", port=port, threads=32, ident="code-visualizer")


if __name__ == "__main__":
    sys.exit(main())
