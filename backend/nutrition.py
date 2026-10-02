"""Typed session protein and water, plus one Open Food Facts product read.

An unentered amount is absent. A nutrient that is not on the record is absent.
Neither becomes zero. Opinions exist only for sodium or salt, sugars, and fibre,
and only when that field is present.
"""
from __future__ import annotations

import math
import re
from typing import Any

import httpx

import tls

USER_AGENT = "IronFlow/1.0 (+https://ironflow.app)"
PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
FIELDS = "product_name,product_name_fr,product_name_en,nutriments,nutrition_data_per,no_nutrition_data,serving_size"
_BARCODE = re.compile(r"^\d{8,14}$")
# _100g / _serving values are grams, or kcal / kJ for energy. Do not convert.
_FACTS = (
    ("energy-kcal", "energy", "kcal"),
    ("energy", "energy", "kJ"),
    ("fat", "fat", "g"),
    ("saturated-fat", "saturated_fat", "g"),
    ("carbohydrates", "carbohydrates", "g"),
    ("sugars", "sugars", "g"),
    ("fiber", "fibre", "g"),
    ("proteins", "proteins", "g"),
    ("salt", "salt", "g"),
    ("sodium", "sodium", "g"),
)


def opinion_for(field: str) -> str | None:
    if field in {"sodium", "salt"}:
        return "sodium"
    if field == "sugars":
        return "sugars"
    if field in {"fibre", "fiber"}:
        return "fibre"
    return None


def parse_amount(value: object) -> float | None:
    """Blank, junk, and negatives stay absent — not zero."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip().replace(",", ".")
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return number


def session_nutrition(protein_g: object, water_ml: object) -> dict[str, float]:
    stored: dict[str, float] = {}
    protein = parse_amount(protein_g)
    water = parse_amount(water_ml)
    if protein is not None:
        stored["protein_g"] = protein
    if water is not None:
        stored["water_ml"] = water
    return stored


def public_log(stored: dict | None) -> dict[str, float | None]:
    raw = stored or {}
    return {
        "protein_g": raw["protein_g"] if "protein_g" in raw else None,
        "water_ml": raw["water_ml"] if "water_ml" in raw else None,
    }


def normalize_barcode(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    code = re.sub(r"\s+", "", raw)
    return code if _BARCODE.fullmatch(code) else None


def product_url(barcode: str) -> str:
    return PRODUCT_URL.format(barcode=barcode) + f"?fields={FIELDS}"


def lookup_failed() -> dict[str, Any]:
    return {"ok": False, "notice": "lookup_failed", "name": None, "basis": None, "serving_size": None, "nutrients": []}


def _number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        text = value.strip().replace(",", ".")
        if not text:
            return None
        try:
            value = float(text)
        except ValueError:
            return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        return number if math.isfinite(number) else None
    return None


def _no_facts(product: dict) -> bool:
    flag = product.get("no_nutrition_data")
    return flag is True or (isinstance(flag, str) and flag.strip().lower() in {"on", "1", "true", "yes"})


def _name(product: dict) -> str | None:
    for key in ("product_name", "product_name_fr", "product_name_en"):
        value = product.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _basis(product: dict) -> str:
    raw = str(product.get("nutrition_data_per") or "100g").strip().lower()
    return "serving" if raw in {"serving", "per serving"} else "100g"


def _rows(nutriments: dict, basis: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for off_key, key, unit in _FACTS:
        if key in seen:
            continue
        value = _number(nutriments.get(f"{off_key}_{basis}"))
        if value is None:
            continue
        seen.add(key)
        rows.append({"key": key, "value": value, "unit": unit, "opinion": opinion_for(key) if key != "salt" else None})
    if any(row["key"] == "sodium" for row in rows):
        for row in rows:
            if row["key"] == "salt":
                row["opinion"] = None
    elif any(row["key"] == "salt" for row in rows):
        for row in rows:
            if row["key"] == "salt":
                row["opinion"] = "sodium"
    return rows


def _empty(name: str | None, notice: str) -> dict[str, Any]:
    return {"ok": True, "notice": notice, "name": name, "basis": None, "serving_size": None, "nutrients": []}


def product_view(payload: object) -> dict[str, Any]:
    """Name and the nutrients actually on this product. No invented zeros."""
    if not isinstance(payload, dict) or payload.get("status") != 1 or not isinstance(payload.get("product"), dict):
        return lookup_failed()
    product = payload["product"]
    name = _name(product)
    if _no_facts(product):
        return _empty(name, "no_facts")
    nutriments = product.get("nutriments") if isinstance(product.get("nutriments"), dict) else {}
    basis = _basis(product)
    rows = _rows(nutriments, basis)
    if not rows:
        other = "100g" if basis == "serving" else "serving"
        alt = _rows(nutriments, other)
        if alt:
            basis, rows = other, alt
    if not rows:
        return _empty(name, "no_facts")
    serving = product.get("serving_size")
    serving_size = serving.strip() if basis == "serving" and isinstance(serving, str) and serving.strip() else None
    return {"ok": True, "notice": None, "name": name, "basis": basis, "serving_size": serving_size, "nutrients": rows}


async def fetch_product(barcode: str) -> dict[str, Any]:
    """One product read. No search, no retry."""
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=tls.client_context()) as client:
            response = await client.get(product_url(barcode), headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    except httpx.HTTPError:
        return lookup_failed()
    if response.status_code != 200:
        return lookup_failed()
    try:
        payload = response.json()
    except ValueError:
        return lookup_failed()
    return product_view(payload)
