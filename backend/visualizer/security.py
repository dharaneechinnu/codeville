"""Who may call the backend. It listens on this computer only, and three checks keep other web pages out:
the Host must be local (stops DNS tricks), the Origin must be the app or a local dev page, and every call
except /health needs the token that only this user's config file holds."""

from __future__ import annotations

import hmac
import re
from typing import Optional

from django.http import HttpResponse, JsonResponse
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication
from rest_framework.response import Response

from .config import load_config

HOST_OK = re.compile(r"^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$")
# The packaged app loads from a file (origin "null"). During development the page runs on a local port.
DEV_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1):51(7\d|8\d|9\d)$")


def origin_allowed(origin: str) -> bool:
    return origin == "null" or bool(DEV_ORIGIN.match(origin))


class GuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        host = request.META.get("HTTP_HOST", "")
        if not HOST_OK.match(host):
            return JsonResponse({"error": "This address is not allowed"}, status=403)
        origin: Optional[str] = request.META.get("HTTP_ORIGIN")
        if origin is not None and not origin_allowed(origin):
            return JsonResponse({"error": "This page is not allowed to talk to the app"}, status=403)
        if request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        if origin is not None:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Headers"] = "content-type,x-cv-token"
            response["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
            response["Vary"] = "Origin"
        return response


class LocalUser:
    """Whoever holds the token is the one user of this computer."""

    is_authenticated = True
    is_anonymous = False
    pk = 1
    username = "local"


class TokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        sent = request.META.get("HTTP_X_CV_TOKEN") or request.query_params.get("token") or ""
        if not hmac.compare_digest(str(sent), load_config()["token"]):
            raise exceptions.AuthenticationFailed("Missing or wrong token. Read it from the app config file.")
        return (LocalUser(), None)

    def authenticate_header(self, request) -> str:
        return "Token"


def exception_handler(exc, context):
    """Every error leaves as {"error": "..."} so messages stay short and the same everywhere."""
    # Imported here: rest_framework.views reads this module while it loads, so a top-level import would loop.
    from rest_framework.views import exception_handler as drf_exception_handler

    response = drf_exception_handler(exc, context)
    if response is None:
        return Response({"error": str(exc) or "Something went wrong"}, status=500)
    data = response.data
    if isinstance(data, dict) and "detail" in data:
        message = str(data["detail"])
    elif isinstance(data, dict):
        first = next(iter(data.values()), "")
        message = str(first[0] if isinstance(first, list) and first else first)
    elif isinstance(data, list) and data:
        message = str(data[0])
    else:
        message = "The request was not accepted"
    response.data = {"error": message}
    return response
