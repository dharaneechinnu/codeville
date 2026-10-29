"""Settings for the Codeville backend. It runs on this computer only, so the checks that matter
(who may call it, from which page) live in visualizer.security, not in ALLOWED_HOSTS."""

import os
from pathlib import Path

from visualizer.config import config_dir

BASE_DIR = Path(__file__).resolve().parent.parent

# Nothing here is exposed to the internet: the server binds to 127.0.0.1 and every request needs the token.
SECRET_KEY = os.environ.get("CV_SECRET_KEY", "local-only-not-a-secret-" + "x" * 24)
DEBUG = os.environ.get("CV_DEBUG") == "1"
ALLOWED_HOSTS = ["*"]  # Host is checked by GuardMiddleware, which answers with a clear JSON error.

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "visualizer",
]

MIDDLEWARE = ["visualizer.security.GuardMiddleware"]

ROOT_URLCONF = "cv_backend.urls"
WSGI_APPLICATION = "cv_backend.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("CV_DB", str(Path(config_dir()) / "visualizer.sqlite3")),
        # Several requests write at once (events, projects). Write-ahead mode and a longer wait stop "database is locked".
        "OPTIONS": {
            "timeout": 20,
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["visualizer.security.TokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "visualizer.security.exception_handler",
    "UNAUTHENTICATED_USER": None,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
}
