"""LLM helpers: strict-JSON generation (GPT-5.4) + document OCR (Gemini vision)."""
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from dotenv import load_dotenv
from emergentintegrations.llm.chat import FileContentWithMimeType, LlmChat, UserMessage

load_dotenv(Path(__file__).parent / ".env")

LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")


async def llm_text(
    system: str,
    user_text: str,
    provider: str = "openai",
    model: str = "gpt-5.4",
    file_paths: Optional[list[tuple[str, str]]] = None,  # [(path, mime)]
) -> str:
    chat = LlmChat(api_key=LLM_KEY, session_id=str(uuid.uuid4()), system_message=system).with_model(
        provider, model
    )
    if file_paths:
        files = [FileContentWithMimeType(file_path=p, mime_type=m) for p, m in file_paths]
        msg = UserMessage(text=user_text, file_contents=files)
    else:
        msg = UserMessage(text=user_text)
    resp = await chat.send_message(msg)
    return resp if isinstance(resp, str) else str(resp)


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
    provider: str = "openai",
    model: str = "gpt-5.4",
) -> Any:
    """Call the LLM and return validated JSON. Retries once with the validation error."""
    prompt = user_text
    last_err: Exception = ValueError("LLM call failed")
    for _ in range(retries + 1):
        raw = await llm_text(system, prompt, provider=provider, model=model)
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


async def ocr_document(path: str, mime: str) -> str:
    """OCR a PDF or photo of a lab report via Gemini vision."""
    return await llm_text(
        system=(
            "You are a precise OCR engine for medical laboratory reports. "
            "Transcribe ALL visible text, keeping table structure line by line "
            "(marker name, value, unit, reference range). Output raw text only."
        ),
        user_text="Transcribe this lab report completely.",
        provider="gemini",
        model="gemini-2.5-flash",
        file_paths=[(path, mime)],
    )
