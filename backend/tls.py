"""TLS verification for outbound calls the app makes on its own behalf.

httpx trusts `certifi`'s bundled roots by default. That breaks wherever the
machine's own trust store matters — a corporate proxy or antivirus that
inspects TLS with a locally installed root, which is exactly the Windows dev
machine this runs on (Node needs `--use-system-ca` there for the same reason).

`client_context()` verifies against the operating system's store instead, with
one relaxation: Python 3.13 turned on `VERIFY_X509_STRICT`, which rejects some
real-world roots over a non-critical Basic Constraints flag. Chain, expiry and
hostname are all still verified — the behaviour of Python 3.12 and earlier.
"""
from __future__ import annotations

import ssl
from functools import lru_cache


@lru_cache(maxsize=1)
def client_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
    return context
