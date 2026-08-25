"""Lab report ingestion & interpretation pipeline (n8n-compatible steps).

upload -> private object storage -> OCR (Gemini vision) -> extraction LLM (strict
JSON) -> normalization (marker registry) -> bounded educational interpretation ->
biomarkers write + readable report -> in-app notification. Full audit log.
Every interpretation carries a disclaimer + "requires professional review" flag.
"""
import os
import re
import unicodedata
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from ai import llm_json, ocr_document
from server import can_access_user_data, clean, current_user, db, new_id, now
from storage import put_object

router = APIRouter()

ALLOWED_MIMES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_BYTES = 15 * 1024 * 1024

DISCLAIMER = (
    "Interprétation éducative générée par IA — ce n'est PAS un avis médical. "
    "Ces informations doivent être validées par un professionnel de santé."
)

# Canonical marker registry: alias (lowercased) -> (slug, display name)
MARKER_MAP: dict[str, tuple[str, str]] = {
    "glucose": ("glucose", "Glucose"), "glycémie": ("glucose", "Glucose"),
    "glycemie": ("glucose", "Glucose"), "hba1c": ("hba1c", "HbA1c"),
    "hémoglobine glyquée": ("hba1c", "HbA1c"), "hemoglobine glyquee": ("hba1c", "HbA1c"),
    "ferritine": ("ferritin", "Ferritine"), "ferritin": ("ferritin", "Ferritine"),
    "fer": ("iron", "Fer sérique"), "iron": ("iron", "Fer sérique"),
    "fer sérique": ("iron", "Fer sérique"), "fer serique": ("iron", "Fer sérique"),
    "vitamine d": ("vitamin_d", "Vitamine D"), "vitamin d": ("vitamin_d", "Vitamine D"),
    "25-oh vitamine d": ("vitamin_d", "Vitamine D"), "25-oh-vitamine d3": ("vitamin_d", "Vitamine D"),
    "vitamine b12": ("vitamin_b12", "Vitamine B12"), "vitamin b12": ("vitamin_b12", "Vitamine B12"),
    "testostérone": ("testosterone", "Testostérone"), "testosterone": ("testosterone", "Testostérone"),
    "testostérone totale": ("testosterone", "Testostérone"),
    "cortisol": ("cortisol", "Cortisol"),
    "crp": ("crp", "CRP"), "protéine c réactive": ("crp", "CRP"), "c-reactive protein": ("crp", "CRP"),
    "crp ultrasensible": ("crp", "CRP"),
    "hémoglobine": ("hemoglobin", "Hémoglobine"), "hemoglobine": ("hemoglobin", "Hémoglobine"),
    "hemoglobin": ("hemoglobin", "Hémoglobine"),
    "hématocrite": ("hematocrit", "Hématocrite"), "hematocrit": ("hematocrit", "Hématocrite"),
    "cholestérol total": ("total_cholesterol", "Cholestérol total"),
    "cholesterol total": ("total_cholesterol", "Cholestérol total"),
    "total cholesterol": ("total_cholesterol", "Cholestérol total"),
    "ldl": ("ldl", "LDL"), "ldl cholestérol": ("ldl", "LDL"), "ldl-cholestérol": ("ldl", "LDL"),
    "hdl": ("hdl", "HDL"), "hdl cholestérol": ("hdl", "HDL"), "hdl-cholestérol": ("hdl", "HDL"),
    "triglycérides": ("triglycerides", "Triglycérides"), "triglycerides": ("triglycerides", "Triglycérides"),
    "tsh": ("tsh", "TSH"), "tsh ultrasensible": ("tsh", "TSH"),
    "créatinine": ("creatinine", "Créatinine"), "creatinine": ("creatinine", "Créatinine"),
    "urée": ("urea", "Urée"), "uree": ("urea", "Urée"), "urea": ("urea", "Urée"),
    "alat": ("alt", "ALAT"), "alt": ("alt", "ALAT"), "asat": ("ast", "ASAT"), "ast": ("ast", "ASAT"),
    "magnésium": ("magnesium", "Magnésium"), "magnesium": ("magnesium", "Magnésium"),
    "sodium": ("sodium", "Sodium"), "potassium": ("potassium", "Potassium"),
    "calcium": ("calcium", "Calcium"), "zinc": ("zinc", "Zinc"),
    "leucocytes": ("wbc", "Leucocytes"), "globules blancs": ("wbc", "Leucocytes"),
    "érythrocytes": ("rbc", "Érythrocytes"), "globules rouges": ("rbc", "Érythrocytes"),
    "plaquettes": ("platelets", "Plaquettes"),
    "folates": ("folate", "Folates"), "acide folique": ("folate", "Folates"),
}


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_") or "unknown"


def normalize_marker(raw_name: str) -> tuple[str, str]:
    key = raw_name.strip().lower()
    if key in MARKER_MAP:
        return MARKER_MAP[key]
    for alias, mapped in MARKER_MAP.items():
        if alias in key:
            return mapped
    return slugify(raw_name), raw_name.strip()


# --------------------------------------------------------------------------- #
# Pipeline schemas                                                            #
# --------------------------------------------------------------------------- #
class ExtractedMarker(BaseModel):
    marker: str
    value: float
    unit: Optional[str] = None
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None


class Trend(BaseModel):
    marker_slug: str
    direction: str = Field(pattern="^(up|down|stable)$")
    comment: str


class Flag(BaseModel):
    marker_slug: str
    severity: str = Field(pattern="^(info|attention|discuss_with_doctor)$")
    comment: str


class Interpretation(BaseModel):
    summary: list[str]
    trends: list[Trend] = []
    flags: list[Flag] = []


EXTRACT_SYSTEM = """You extract laboratory biomarkers from OCR text of a blood panel.
Output ONLY a JSON array (no prose): [{"marker":"Ferritine","value":95.0,"unit":"ng/mL",
"ref_low":30,"ref_high":300}]. "value" must be numeric (convert commas to dots).
ref_low/ref_high null when absent. NEVER invent values not present in the text.
Skip qualitative results without a numeric value."""

INTERPRET_SYSTEM = """Tu es un assistant ÉDUCATIF (NON médical) pour athlètes de force/endurance.
À partir des marqueurs du jour et de l'historique, produis UNIQUEMENT ce JSON (en français) :
{"summary":["point 1","point 2"],"trends":[{"marker_slug":"ferritin","direction":"up|down|stable",
"comment":"..."}],"flags":[{"marker_slug":"ferritin","severity":"info|attention|discuss_with_doctor",
"comment":"..."}]}
RÈGLES STRICTES : contexte sportif (impact possible sur performance, récupération, adaptation à
l'entraînement) ; tendances vs historique fourni ; tout marqueur hors plage de référence devient un
flag "discuss_with_doctor" ou "attention". JAMAIS de diagnostic, JAMAIS de prescription ou dosage,
ton prudent. 2 à 5 points de summary maximum. Aucun texte hors du JSON."""


# --------------------------------------------------------------------------- #
# Audit helpers                                                               #
# --------------------------------------------------------------------------- #
async def log_step(report_id: str, user_id: str, step: str, status: str, detail: str = ""):
    entry = {"step": step, "status": status, "detail": detail[:500], "at": now()}
    await db.lab_reports.update_one(
        {"id": report_id}, {"$push": {"steps": entry}, "$set": {"step": step}}
    )
    await db.audit_logs.insert_one(
        {
            "id": new_id(),
            "user_id": user_id,
            "report_id": report_id,
            "actor": "pipeline",
            "step": step,
            "status": status,
            "detail": detail[:2000],
            "at": now(),
        }
    )


async def run_pipeline(report_id: str, user_id: str, tmp_path: str, mime: str):
    """n8n-equivalent workflow, one function per node, fully audited."""
    try:
        # 2. OCR
        await log_step(report_id, user_id, "ocr", "started")
        raw_text = await ocr_document(tmp_path, mime)
        await db.lab_reports.update_one({"id": report_id}, {"$set": {"raw_text": raw_text[:20000]}})
        await log_step(report_id, user_id, "ocr", "done", f"{len(raw_text)} chars")

        # 3. Extraction LLM -> strict JSON
        await log_step(report_id, user_id, "extraction", "started")

        def _v_extract(data) -> list[ExtractedMarker]:
            if not isinstance(data, list):
                raise ValueError("expected a JSON array")
            return [ExtractedMarker.model_validate(x) for x in data]

        extracted = await llm_json(
            EXTRACT_SYSTEM, f"OCR TEXT:\n{raw_text[:15000]}", validator=_v_extract
        )
        if not extracted:
            raise ValueError("No biomarkers found in the document")
        await log_step(report_id, user_id, "extraction", "done", f"{len(extracted)} markers")

        # 4. Normalization against the marker registry
        await log_step(report_id, user_id, "normalization", "started")
        normalized = []
        for m in extracted:
            slug, name = normalize_marker(m.marker)
            normalized.append(
                {
                    "marker_slug": slug,
                    "marker": name,
                    "raw_name": m.marker,
                    "value": m.value,
                    "unit": m.unit,
                    "ref_low": m.ref_low,
                    "ref_high": m.ref_high,
                }
            )
        await log_step(report_id, user_id, "normalization", "done")

        # 5. Bounded educational interpretation (with history)
        await log_step(report_id, user_id, "interpretation", "started")
        history = [
            f"{b.get('marker_slug', b['marker'])}={b['value']} {b.get('unit') or ''} le {b['measured_at']:%Y-%m-%d}"
            async for b in db.biomarkers.find({"user_id": user_id}, {"_id": 0})
            .sort("measured_at", -1)
            .limit(40)
        ]
        today = "\n".join(
            f"{n['marker_slug']} ({n['marker']}): {n['value']} {n['unit'] or ''} "
            f"[ref {n['ref_low']}-{n['ref_high']}]"
            for n in normalized
        )
        interp = await llm_json(
            INTERPRET_SYSTEM,
            f"MARQUEURS DU JOUR:\n{today}\n\nHISTORIQUE:\n" + ("\n".join(history) or "aucun"),
            validator=lambda d: Interpretation.model_validate(d),
        )

        # 6. Write biomarkers + readable report
        measured = now()
        for n in normalized:
            await db.biomarkers.insert_one(
                {
                    "id": new_id(),
                    "user_id": user_id,
                    "marker": n["marker"],
                    "marker_slug": n["marker_slug"],
                    "value": n["value"],
                    "unit": n["unit"] or "",
                    "reference_low": n["ref_low"],
                    "reference_high": n["ref_high"],
                    "notes": None,
                    "source": "lab_upload",
                    "report_id": report_id,
                    "measured_at": measured,
                    "created_at": now(),
                }
            )
        await db.lab_reports.update_one(
            {"id": report_id},
            {
                "$set": {
                    "status": "done",
                    "markers": normalized,
                    "markers_count": len(normalized),
                    "interpretation": interp.model_dump(),
                    "completed_at": now(),
                }
            },
        )
        await log_step(report_id, user_id, "write", "done", f"{len(normalized)} biomarkers written")

        # 7. Callback -> in-app notification (n8n webhook equivalent)
        await db.notifications.insert_one(
            {
                "id": new_id(),
                "user_id": user_id,
                "type": "lab_report_ready",
                "report_id": report_id,
                "read": False,
                "created_at": now(),
            }
        )
        await log_step(report_id, user_id, "callback", "done", "notification created")
    except Exception as e:  # noqa: BLE001 — pipeline must record its own failure
        await db.lab_reports.update_one(
            {"id": report_id}, {"$set": {"status": "failed", "error": str(e)[:500]}}
        )
        await log_step(report_id, user_id, "pipeline", "failed", str(e))
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# Endpoints                                                                   #
# --------------------------------------------------------------------------- #
@router.post("/labs/upload", status_code=201)
async def upload_lab(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_MIMES:
        raise HTTPException(415, "Formats acceptés : PDF, JPG, PNG, WebP")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Fichier trop volumineux (max 15 Mo)")
    if not data:
        raise HTTPException(422, "Fichier vide")

    report_id = new_id()
    ext = ALLOWED_MIMES[mime]
    storage_path = f"ironflow/uploads/{user['id']}/{report_id}.{ext}"
    tmp_path = f"/tmp/ironflow_{report_id}.{ext}"
    with open(tmp_path, "wb") as f:
        f.write(data)
    try:
        await run_in_threadpool(put_object, storage_path, data, mime)
        stored = True
    except Exception as e:  # noqa: BLE001 — storage outage must not block the pipeline
        stored = False
        await db.audit_logs.insert_one(
            {
                "id": new_id(),
                "user_id": user["id"],
                "report_id": report_id,
                "actor": "pipeline",
                "step": "storage",
                "status": "failed",
                "detail": str(e)[:500],
                "at": now(),
            }
        )

    doc = {
        "id": report_id,
        "user_id": user["id"],
        "filename": file.filename,
        "mime": mime,
        "storage_path": storage_path if stored else None,
        "status": "processing",
        "step": "received",
        "steps": [{"step": "received", "status": "done", "detail": file.filename or "", "at": now()}],
        "markers": [],
        "markers_count": 0,
        "interpretation": None,
        "disclaimer": DISCLAIMER,
        "requires_professional_review": True,
        "created_at": now(),
    }
    await db.lab_reports.insert_one(dict(doc))
    background.add_task(run_pipeline, report_id, user["id"], tmp_path, mime)
    return clean(doc)


@router.get("/labs/reports")
async def list_reports(user: dict = Depends(current_user), owner_id: Optional[str] = None):
    target = owner_id or user["id"]
    if not await can_access_user_data(user["id"], target):
        raise HTTPException(403, "Not allowed")
    return [
        clean(r)
        async for r in db.lab_reports.find({"user_id": target}, {"_id": 0, "raw_text": 0})
        .sort("created_at", -1)
        .limit(30)
    ]


@router.get("/labs/reports/{report_id}")
async def get_report(report_id: str, user: dict = Depends(current_user)):
    r = await db.lab_reports.find_one({"id": report_id}, {"_id": 0, "raw_text": 0})
    if not r:
        raise HTTPException(404, "Not found")
    if not await can_access_user_data(user["id"], r["user_id"]):
        raise HTTPException(403, "Not allowed")
    return clean(r)


@router.get("/biomarkers/grouped")
async def biomarkers_grouped(user: dict = Depends(current_user), owner_id: Optional[str] = None):
    """Time series per canonical marker for plotting."""
    target = owner_id or user["id"]
    if not await can_access_user_data(user["id"], target):
        raise HTTPException(403, "Not allowed")
    groups: dict[str, dict] = {}
    async for b in db.biomarkers.find({"user_id": target}, {"_id": 0}).sort("measured_at", 1):
        slug = b.get("marker_slug") or slugify(b["marker"])
        g = groups.setdefault(
            slug,
            {
                "slug": slug,
                "name": b["marker"],
                "unit": b.get("unit") or "",
                "ref_low": b.get("reference_low"),
                "ref_high": b.get("reference_high"),
                "points": [],
            },
        )
        g["points"].append({"date": b["measured_at"].strftime("%Y-%m-%d"), "value": b["value"]})
        g["ref_low"] = b.get("reference_low") or g["ref_low"]
        g["ref_high"] = b.get("reference_high") or g["ref_high"]
        g["latest"] = b["value"]
    return sorted(groups.values(), key=lambda g: g["name"])


@router.get("/notifications")
async def list_notifications(user: dict = Depends(current_user)):
    return [
        clean(n)
        async for n in db.notifications.find({"user_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(20)
    ]


class N8nCallback(BaseModel):
    """Ready-to-plug endpoint so a future external n8n can push results back."""
    secret: str
    report_id: str
    markers: list[ExtractedMarker]
    interpretation: Interpretation


@router.post("/webhooks/n8n/labs")
async def n8n_labs_callback(body: N8nCallback):
    expected = os.environ.get("N8N_WEBHOOK_SECRET")
    if not expected or body.secret != expected:
        raise HTTPException(401, "Invalid webhook secret")
    r = await db.lab_reports.find_one({"id": body.report_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Report not found")
    normalized = []
    for m in body.markers:
        slug, name = normalize_marker(m.marker)
        normalized.append(
            {"marker_slug": slug, "marker": name, "raw_name": m.marker, "value": m.value,
             "unit": m.unit, "ref_low": m.ref_low, "ref_high": m.ref_high}
        )
    await db.lab_reports.update_one(
        {"id": body.report_id},
        {"$set": {"status": "done", "markers": normalized, "markers_count": len(normalized),
                  "interpretation": body.interpretation.model_dump(), "completed_at": now()}},
    )
    await log_step(body.report_id, r["user_id"], "n8n_callback", "done")
    return {"received": True}
