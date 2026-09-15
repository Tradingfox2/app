"""Link previews for posts: the title, description and image behind a URL.

Fetching a URL a member typed is a server-side request forgery surface, so
every rule here exists to keep it from becoming one:

1. **https only**, standard port, no credentials in the URL.
2. **Every resolved address must be public.** Private, loopback, link-local,
   reserved and multicast ranges are refused — that is what stops a post from
   probing the cloud metadata service or the internal network. Redirects are
   followed by hand so each hop is checked the same way.
3. **Small and fast:** a 3 s timeout, 256 KB read ceiling, HTML only.

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

import httpx

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(r"https://[^\s<>\"']{4,500}", re.IGNORECASE)
TIMEOUT_SECONDS = 3.0
MAX_BYTES = 256 * 1024
MAX_REDIRECTS = 3
USER_AGENT = "IronFlowLinkPreview/1.0 (+https://ironflow.app)"


def first_url(content: str) -> str | None:
    match = URL_PATTERN.search(content or "")
    return match.group(0).rstrip(".,;:!?)]}") if match else None


def _public_host(host: str) -> bool:
    """True only when every address the host resolves to is public."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError):
        return False
    if not infos:
        return False
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (address.is_private or address.is_loopback or address.is_link_local
                or address.is_reserved or address.is_multicast or address.is_unspecified):
            return False
    return True


def safe_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return False
    if parts.port not in (None, 443):
        return False
    return _public_host(parts.hostname)


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
    try:
        current = url
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False,
                                     headers={"User-Agent": USER_AGENT, "Accept": "text/html"}) as client:
            for _ in range(MAX_REDIRECTS + 1):
                if not safe_url(current):
                    return None
                async with client.stream("GET", current) as response:
                    if response.is_redirect:
                        current = urljoin(current, response.headers.get("location", ""))
                        continue
                    if response.status_code != 200:
                        return None
                    if "text/html" not in response.headers.get("content-type", ""):
                        return None
                    body = b""
                    async for chunk in response.aiter_bytes():
                        body += chunk
                        if len(body) >= MAX_BYTES:
                            break
                    return parse(body[:MAX_BYTES].decode(response.encoding or "utf-8", errors="replace"), current)
    except Exception as exc:  # noqa: BLE001 - a preview is decoration, never a failure
        logger.info("Link preview for %s failed: %s", url, exc)
    return None
