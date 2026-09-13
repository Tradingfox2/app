"""LLM helpers: strict-JSON generation + document OCR (vision).

Pluggable providers, selected via `LLM_PROVIDER` in backend/.env:

    anthropic   Claude Messages API   (ANTHROPIC_API_KEY, ANTHROPIC_MODEL)
    ollama      local / remote Ollama  (OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_VISION_MODEL)
    openrouter  OpenRouter (OpenAI-compatible chat) (OPENROUTER_API_KEY, OPENROUTER_MODEL)
    auto        first configured of: anthropic -> openrouter -> ollama  (default)

Every call goes through `llm_text`; `llm_json` adds strict-JSON parsing with a
validation-error retry; `ocr_document` sends an image / PDF to a vision-capable
model. No SDKs: plain httpx against each provider's public REST API.
"""
from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# Use the OS certificate store (Windows/macOS) for outbound TLS. On machines
# behind a corporate proxy / antivirus that re-signs HTTPS, Python's bundled
# certifi CAs reject api.anthropic.com with CERTIFICATE_VERIFY_FAILED; the
# system store contains the local root and fixes it. Harmless elsewhere.
try:  # pragma: no cover - environment dependent
    import truststore

    truststore.inject_into_ssl()
except Exception:  # noqa: BLE001
    pass

# --------------------------------------------------------------------------- #
# Provider configuration                                                      #
# --------------------------------------------------------------------------- #
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "auto").strip().lower()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5").strip()
# Per-task routing (cost vs. depth):
#   program  -> Sonnet 5 with adaptive thinking at `ANTHROPIC_EFFORT_PROGRAM` (medium)
#   fast     -> Haiku 4.5 for tips, coach one-liners, muscle circuits
ANTHROPIC_MODEL_PROGRAM = os.environ.get("ANTHROPIC_MODEL_PROGRAM", "claude-sonnet-5").strip()
ANTHROPIC_MODEL_FAST = os.environ.get("ANTHROPIC_MODEL_FAST", "claude-haiku-4-5").strip()
ANTHROPIC_MODEL_LABS = os.environ.get(
    "ANTHROPIC_MODEL_LABS", "claude-sonnet-4-6"
).strip()
ANTHROPIC_EFFORT_PROGRAM = os.environ.get("ANTHROPIC_EFFORT_PROGRAM", "medium").strip().lower()
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
ANTHROPIC_VERSION = "2023-06-01"

# Models that use adaptive thinking (+ effort). Older families (Haiku 4.5,
# Sonnet/Opus 4.x) only accept {"type":"enabled","budget_tokens":N}, so we
# never send `thinking` to them.
ADAPTIVE_THINKING_PREFIXES = ("claude-sonnet-5", "claude-opus-5", "claude-opus-4-7", "claude-opus-4-8", "claude-fable")

TASKS = ("default", "program", "fast", "labs")

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:latest").strip()
# Vision-capable Ollama model for OCR (e.g. llama3.2-vision, qwen2.5vl, minicpm-v).
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "").strip()

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.6").strip()
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")

LLM_TIMEOUT_SEC = float(os.environ.get("LLM_TIMEOUT_SEC", "240"))
LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "4096"))

PROVIDERS = ("anthropic", "ollama", "openrouter")


class LLMError(ValueError):
    """Raised for any provider/transport failure (callers map it to HTTP 502)."""


class LLMNotConfigured(LLMError):
    """Raised when no provider has credentials / is reachable."""


def resolve_provider(explicit: Optional[str] = None) -> str:
    """Pick the provider to use. `auto` = first configured in priority order."""
    wanted = (explicit or LLM_PROVIDER or "auto").lower()
    if wanted in PROVIDERS:
        return wanted
    if ANTHROPIC_API_KEY:
        return "anthropic"
    if OPENROUTER_API_KEY:
        return "openrouter"
    return "ollama"


def default_model(provider: str, task: str = "default") -> str:
    if provider == "anthropic":
        return {
            "program": ANTHROPIC_MODEL_PROGRAM,
            "fast": ANTHROPIC_MODEL_FAST,
            "labs": ANTHROPIC_MODEL_LABS,
        }.get(task, ANTHROPIC_MODEL)
    # Ollama / OpenRouter: one configured model for every task.
    return {"ollama": OLLAMA_MODEL, "openrouter": OPENROUTER_MODEL}[provider]


def active_model_label(provider: Optional[str] = None, task: str = "default") -> str:
    p = resolve_provider(provider)
    return f"{p}:{default_model(p, task)}"


def provider_status() -> dict[str, Any]:
    """Cheap, non-network summary for GET /api/coach/status."""
    active = resolve_provider()
    return {
        "provider": active,
        "model": default_model(active),
        "models": {
            "default": default_model(active),
            "program": default_model(active, "program"),
            "fast": default_model(active, "fast"),
            "labs": default_model("anthropic", "labs"),
            "program_effort": ANTHROPIC_EFFORT_PROGRAM if active == "anthropic" else None,
        },
        "configured": {
            "anthropic": bool(ANTHROPIC_API_KEY),
            "openrouter": bool(OPENROUTER_API_KEY),
            "ollama": True,  # always "configured"; reachability checked separately
        },
        "ollama_base_url": OLLAMA_BASE_URL,
        "ollama_vision_model": OLLAMA_VISION_MODEL or None,
    }


async def ollama_models() -> list[str]:
    """List models installed on the Ollama server (empty list if unreachable)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            r.raise_for_status()
            return [m.get("name", "") for m in r.json().get("models", []) if m.get("name")]
    except Exception:  # noqa: BLE001 — offline Ollama is a normal state
        return []


# --------------------------------------------------------------------------- #
# Transport per provider                                                      #
# --------------------------------------------------------------------------- #
def _read_b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


async def _anthropic(
    system: str,
    user_text: str,
    model: str,
    files: list[tuple[str, str]],
    task: str = "default",
) -> str:
    if not ANTHROPIC_API_KEY:
        raise LLMNotConfigured("ANTHROPIC_API_KEY is not set in backend/.env")
    content: list[dict[str, Any]] = []
    for path, mime in files:
        block_type = "document" if mime == "application/pdf" else "image"
        content.append(
            {
                "type": block_type,
                "source": {"type": "base64", "media_type": mime, "data": _read_b64(path)},
            }
        )
    content.append({"type": "text", "text": user_text})
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": LLM_MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": content}],
    }
    if task == "program" and model.startswith(ADAPTIVE_THINKING_PREFIXES):
        # Deep task: adaptive thinking at the configured effort (medium by default).
        payload["thinking"] = {"type": "adaptive"}
        payload["output_config"] = {"effort": ANTHROPIC_EFFORT_PROGRAM}
        payload["max_tokens"] = max(LLM_MAX_TOKENS, 12000)
    elif model.startswith(ADAPTIVE_THINKING_PREFIXES):
        # Cheap/fast tasks on an adaptive model: keep effort low.
        payload["output_config"] = {"effort": "low"}
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT_SEC) as client:
            r = await client.post(f"{ANTHROPIC_BASE_URL}/v1/messages", json=payload, headers=headers)
    except httpx.HTTPError as e:
        raise LLMError(f"Anthropic unreachable: {e}") from e
    if r.status_code >= 400:
        raise LLMError(f"Anthropic {r.status_code}: {r.text[:300]}")
    data = r.json()
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


async def _ollama(
    system: str, user_text: str, model: str, files: list[tuple[str, str]], task: str = "default"
) -> str:
    images = [_read_b64(p) for p, mime in files if mime.startswith("image/")]
    if any(mime == "application/pdf" for _, mime in files):
        raise LLMError("Ollama vision models accept images only — PDFs need Anthropic or OpenRouter")
    user_msg: dict[str, Any] = {"role": "user", "content": user_text}
    if images:
        user_msg["images"] = images
    payload = {
        "model": model,
        "stream": False,
        "messages": [{"role": "system", "content": system}, user_msg],
        "options": {"temperature": 0.3, "num_predict": LLM_MAX_TOKENS},
    }
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT_SEC) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
    except httpx.HTTPError as e:
        raise LLMNotConfigured(f"Ollama unreachable at {OLLAMA_BASE_URL}: {e}") from None
    if r.status_code >= 400:
        raise LLMError(f"Ollama {r.status_code}: {r.text[:300]}")
    text = r.json().get("message", {}).get("content", "")
    # Reasoning models (qwen3, deepseek-r1) wrap chain-of-thought in <think>…</think>.
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


async def _openrouter(
    system: str, user_text: str, model: str, files: list[tuple[str, str]], task: str = "default"
) -> str:
    if not OPENROUTER_API_KEY:
        raise LLMNotConfigured("OPENROUTER_API_KEY is not set in backend/.env")
    parts: list[dict[str, Any]] = []
    for path, mime in files:
        data_url = f"data:{mime};base64,{_read_b64(path)}"
        if mime == "application/pdf":
            parts.append({"type": "file", "file": {"filename": Path(path).name, "file_data": data_url}})
        else:
            parts.append({"type": "image_url", "image_url": {"url": data_url}})
    parts.append({"type": "text", "text": user_text})
    payload = {
        "model": model,
        "max_tokens": LLM_MAX_TOKENS,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": parts if files else user_text},
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ironflow.app",
        "X-Title": "IronFlow Coach",
    }
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT_SEC) as client:
        r = await client.post(f"{OPENROUTER_BASE_URL}/chat/completions", json=payload, headers=headers)
    if r.status_code >= 400:
        raise LLMError(f"OpenRouter {r.status_code}: {r.text[:300]}")
    choices = r.json().get("choices") or []
    if not choices:
        raise LLMError("OpenRouter returned no choices")
    content = choices[0].get("message", {}).get("content", "")
    return content if isinstance(content, str) else "".join(c.get("text", "") for c in content)


_TRANSPORTS = {"anthropic": _anthropic, "ollama": _ollama, "openrouter": _openrouter}


# --------------------------------------------------------------------------- #
# Public API (signature kept stable for routers/program.py & routers/labs.py) #
# --------------------------------------------------------------------------- #
async def llm_text(
    system: str,
    user_text: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    file_paths: Optional[list[tuple[str, str]]] = None,  # [(path, mime)]
    task: str = "default",  # default | program | fast | labs
) -> str:
    p = resolve_provider(provider)
    m = model or default_model(p, task)
    return await _TRANSPORTS[p](system, user_text, m, file_paths or [], task)


def parse_json_block(text: str) -> Any:
    """Extract the first JSON object/array from an LLM response."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip().strip("`").strip()
    start_obj = cleaned.find("{")
    start_arr = cleaned.find("[")
    starts = [i for i in (start_obj, start_arr) if i >= 0]
    if not starts:
        raise ValueError("No JSON found in LLM response")
    start = min(starts)
    decoder = json.JSONDecoder()
    obj, _ = decoder.raw_decode(cleaned[start:])
    return obj


async def llm_json(
    system: str,
    user_text: str,
    validator: Optional[Callable[[Any], Any]] = None,
    retries: int = 1,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    task: str = "default",
) -> Any:
    """Call the LLM and return validated JSON. Retries once with the validation error."""
    prompt = user_text
    last_err: Exception = ValueError("LLM call failed")
    for _ in range(retries + 1):
        raw = await llm_text(system, prompt, provider=provider, model=model, task=task)
        try:
            data = parse_json_block(raw)
            return validator(data) if validator else data
        except Exception as e:  # noqa: BLE001 — feed error back for one retry
            last_err = e
            prompt = (
                f"{user_text}\n\nYour previous answer was invalid: {e}\n"
                "Return ONLY corrected JSON matching the schema. No prose."
            )
    raise ValueError(f"LLM returned invalid JSON after retries: {last_err}")


async def llm_labs_json(
    system: str,
    user_text: str,
    validator: Optional[Callable[[Any], Any]] = None,
) -> Any:
    """Route lab-result interpretation exclusively through Claude Sonnet 4."""
    return await llm_json(
        system,
        user_text,
        validator=validator,
        provider="anthropic",
        task="labs",
    )


async def ocr_document(path: str, mime: str) -> str:
    """OCR a PDF or photo of a lab report via a vision-capable model."""
    p = resolve_provider()
    model = OLLAMA_VISION_MODEL if p == "ollama" and OLLAMA_VISION_MODEL else None
    if p == "ollama" and not model:
        raise LLMNotConfigured("Set OLLAMA_VISION_MODEL (e.g. llama3.2-vision) or use Anthropic/OpenRouter for OCR")
    return await llm_text(
        system=(
            "You are a precise OCR engine for medical laboratory reports. "
            "Transcribe ALL visible text, keeping table structure line by line "
            "(marker name, value, unit, reference range). Output raw text only."
        ),
        user_text="Transcribe this lab report completely.",
        provider=p,
        model=model,
        file_paths=[(path, mime)],
    )
