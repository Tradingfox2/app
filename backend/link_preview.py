"""Link previews for posts: the title, description and image behind a URL.

Fetching a URL a member typed is a server-side request forgery surface, so
every rule here exists to keep it from becoming one:

1. **https only**, standard port, no credentials in the URL.
2. **Every resolved address must be public, and the connection is pinned to
   the address that was checked.** Private, loopback, link-local, reserved and
   multicast ranges are refused — that is what stops a post from probing the
   cloud metadata service or the internal network. The TCP connection is then
   opened to that exact IP by a pinned network backend: the URL, Host header,
   SNI and certificate check all use the real hostname as normal, but no
   second DNS lookup ever happens, which closes the rebinding gap where a
   lookup at connect time could answer with a private address. Redirects are
   followed by hand so each hop is checked and pinned the same way.
3. **Small and fast:** a 3 s timeout, HTML only, and reading stops at `</head>`
   (where the tags live) or 1.5 MB — some pages, YouTube's among them, carry
   ~700 KB of inline script before their `<title>`.

A preview is decoration. Any failure returns None and the post is published
without one; it never blocks or fails the write.
"""
from __future__ import annotations

import html
import ipaddress
import logging
import re
import socket
from urllib.parse import urljoin, urlsplit

import httpcore

import tls

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(r"https://[^\s<>\"']{4,500}", re.IGNORECASE)
TIMEOUT_SECONDS = 3.0
MAX_BYTES = 1536 * 1024
MAX_REDIRECTS = 3
USER_AGENT = "IronFlowLinkPreview/1.0 (+https://ironflow.app)"


def first_url(content: str) -> str | None:
    match = URL_PATTERN.search(content or "")
    return match.group(0).rstrip(".,;:!?)]}") if match else None


def _public_addresses(host: str) -> list[str]:
    """Every address `host` resolves to — or nothing if any one is not public.

    One private answer poisons the lot: a name that resolves to both a public
    and an internal address is exactly what a rebinding attack looks like.
    """
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError):
        return []
    addresses: list[str] = []
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (address.is_private or address.is_loopback or address.is_link_local
                or address.is_reserved or address.is_multicast or address.is_unspecified):
            return []
        addresses.append(str(address))
    return list(dict.fromkeys(addresses))


def _checked(url: str) -> tuple[str, str] | None:
    """(hostname, pinned address) for a URL that may be fetched, else None."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return None
    if parts.port not in (None, 443):
        return None
    addresses = _public_addresses(parts.hostname)
    return (parts.hostname, addresses[0]) if addresses else None


def safe_url(url: str) -> bool:
    return _checked(url) is not None


class _PinnedBackend(httpcore.AsyncNetworkBackend):
    """Opens TCP connections only to addresses that were vetted beforehand.

    `pins` maps hostname -> checked IP. A hostname with no pin is refused
    outright, so nothing — not a redirect, not a retry — can make the pool
    resolve a name on its own.
    """

    def __init__(self, pins: dict[str, str]):
        self.pins = pins
        self._inner = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        address = self.pins.get(host)
        if address is None:
            raise httpcore.ConnectError(f"{host} was not vetted")
        return await self._inner.connect_tcp(address, port, timeout=timeout,
                                             local_address=local_address, socket_options=socket_options)

    async def connect_unix_socket(self, *args, **kwargs):
        raise httpcore.ConnectError("unix sockets are never used for previews")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


_META = re.compile(
    r"<meta\s+[^>]*?(?:property|name)\s*=\s*[\"'](?P<key>og:[a-z:_]+|twitter:[a-z:_]+|description)[\"'][^>]*?>",
    re.IGNORECASE,
)
_CONTENT = re.compile(r"content\s*=\s*[\"'](?P<value>[^\"']*)[\"']", re.IGNORECASE)
_TITLE = re.compile(r"<title[^>]*>(?P<title>.*?)</title>", re.IGNORECASE | re.DOTALL)


def parse(document: str, url: str) -> dict | None:
    """OpenGraph first, then Twitter cards, then <title>/<meta description>."""
    meta: dict[str, str] = {}
    for tag in _META.finditer(document):
        content = _CONTENT.search(tag.group(0))
        if content:
            meta.setdefault(tag.group("key").lower(), html.unescape(content.group("value")).strip())
    title = meta.get("og:title") or meta.get("twitter:title")
    if not title:
        found = _TITLE.search(document)
        title = html.unescape(re.sub(r"\s+", " ", found.group("title"))).strip() if found else None
    if not title:
        return None
    description = meta.get("og:description") or meta.get("twitter:description") or meta.get("description") or ""
    image = meta.get("og:image") or meta.get("twitter:image")
    if image:
        image = urljoin(url, image)
        if not image.startswith("https://"):
            image = None  # never mix insecure content into the feed
    return {
        "url": url,
        "title": title[:200],
        "description": description[:300],
        "image_url": image,
        "site_name": (meta.get("og:site_name") or urlsplit(url).hostname or "")[:80],
    }


async def fetch(url: str) -> dict | None:
    """The preview for `url`, or None. Never raises."""
    pins: dict[str, str] = {}
    timeouts = {"connect": TIMEOUT_SECONDS, "read": TIMEOUT_SECONDS, "write": TIMEOUT_SECONDS, "pool": TIMEOUT_SECONDS}
    headers = [(b"User-Agent", USER_AGENT.encode()), (b"Accept", b"text/html"), (b"Accept-Language", b"en")]
    try:
        async with httpcore.AsyncConnectionPool(
            ssl_context=tls.client_context(), network_backend=_PinnedBackend(pins), retries=0,
        ) as pool:
            current = url
            for _ in range(MAX_REDIRECTS + 1):
                checked = _checked(current)
                if not checked:
                    return None
                hostname, address = checked
                pins[hostname] = address
                async with pool.stream("GET", current, headers=headers, extensions={"timeout": timeouts}) as response:
                    fields = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in response.headers}
                    if response.status in (301, 302, 303, 307, 308) and fields.get("location"):
                        current = urljoin(current, fields["location"])
                        continue
                    if response.status != 200 or "text/html" not in fields.get("content-type", ""):
                        return None
                    body = b""
                    async for chunk in response.aiter_stream():
                        body += chunk
                        # The tags live in <head>; nothing after it is needed.
                        if len(body) >= MAX_BYTES or b"</head>" in body[-len(chunk) - 7:]:
                            break
                    charset = re.search(r"charset=([\w-]+)", fields.get("content-type", ""))
                    return parse(body[:MAX_BYTES].decode(charset.group(1) if charset else "utf-8", errors="replace"), current)
    except Exception as exc:  # noqa: BLE001 - a preview is decoration, never a failure
        logger.info("Link preview for %s failed: %s", url, exc)
    return None
