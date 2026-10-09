"""Per-request handles that staff checks can read without a new dependency argument.

Direct function calls in tests leave the request unset, so they do not look
like HTTP writes.
"""
from __future__ import annotations

from contextvars import ContextVar

from starlette.requests import Request

_request: ContextVar[Request | None] = ContextVar("ironflow_request", default=None)


def current_request() -> Request | None:
    return _request.get()


def set_request(request: Request | None):
    return _request.set(request)


def reset_request(token) -> None:
    _request.reset(token)
