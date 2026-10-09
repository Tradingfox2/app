"""Staff (back-office) roles, permissions and the immutable audit trail.

Product roles (athlete / coach) stay separate from staff power: registration can
never set `staff_role`, and only an admin can grant it. Every staff action is
written to `audit_log` with an actor, a target and a reason.
"""
from __future__ import annotations

import re
from datetime import timedelta

from fastapi import Depends, HTTPException

from request_context import current_request
from server import current_user, db, new_id, now
from staff_roles import PERMISSIONS, STAFF_ROLES, StaffRole

# Re-export the role table, including accounting.read. Callers and tests keep
# using `staff.STAFF_ROLES` and `staff.PERMISSIONS`; the definitions live in
# staff_roles so grant_staff can read them without importing this module.
__all__ = [
    "ANALYTICS_VIEW_WINDOW",
    "PERMISSIONS",
    "STAFF_ROLES",
    "StaffRole",
    "audit",
    "audit_denied",
    "audit_view",
    "is_staff",
    "permissions_for",
    "require",
]

# One analytics.viewed row per actor per panel inside this window.
# A second open in the same window does not append another row.
ANALYTICS_VIEW_WINDOW = timedelta(minutes=15)
_WRITE = {"POST", "PUT", "PATCH", "DELETE"}
_REASON_CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_OUTCOME = {"success", "failed", "denied"}


def permissions_for(user: dict) -> set[str]:
    return PERMISSIONS.get(user.get("staff_role") or "", set())


def is_staff(user: dict) -> bool:
    return bool(permissions_for(user))


def require(permission: str):
    """Dependency factory: 403 unless the caller's staff role grants `permission`."""
    async def guard(user: dict = Depends(current_user)) -> dict:
        if permission not in permissions_for(user):
            request = current_request()
            # Direct calls in tests have no request. HTTP writes record the denial.
            if request is not None and request.method in _WRITE:
                await audit_denied(
                    user, "staff.permission_denied",
                    target_type="permission", target_id=permission,
                    outcome="denied", reason_code="permission_denied",
                )
            raise HTTPException(403, "Staff permission required")
        return user
    return guard


def _stable_code(reason_code: str) -> str:
    if _REASON_CODE.fullmatch(reason_code):
        return reason_code
    return "unspecified"


async def audit(actor: dict, action: str, *, target_type: str, target_id: str,
                reason: str | None = None, metadata: dict | None = None,
                outcome: str = "success", reason_code: str | None = None) -> dict:
    """Append one audit row.

    `outcome` is success, failed, or denied. A failed or denied row stores a
    stable `reason_code` and does not store the caller's note or the error text.
    """
    if outcome not in _OUTCOME:
        outcome = "failed"
        reason_code = "unspecified"
    if outcome != "success":
        reason = None
        reason_code = _stable_code(reason_code or "unspecified")
        metadata = {"reason_code": reason_code}
    entry = {
        "id": new_id(),
        "actor_id": actor["id"],
        "actor_email": actor.get("email"),
        "actor_staff_role": actor.get("staff_role"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "reason": reason,
        "reason_code": reason_code,
        "outcome": outcome,
        "metadata": metadata or {},
        "created_at": now(),
    }
    await db.audit_log.insert_one(dict(entry))
    return entry


async def audit_denied(actor: dict, action: str, *, target_type: str, target_id: str,
                       outcome: str, reason_code: str) -> dict:
    """Record a staff mutation that did not happen. No note, no body, no secret."""
    if outcome not in {"failed", "denied"}:
        outcome = "failed"
    return await audit(
        actor, action, target_type=target_type, target_id=target_id,
        outcome=outcome, reason_code=reason_code,
    )


async def audit_view(actor: dict, action: str, *, target_type: str, target_id: str,
                     metadata: dict | None = None) -> dict | None:
    """Write a panel-view row unless this actor already has one inside the window."""
    cutoff = now() - ANALYTICS_VIEW_WINDOW
    existing = await db.audit_log.find_one({
        "actor_id": actor["id"],
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "created_at": {"$gte": cutoff},
        "$or": [{"outcome": "success"}, {"outcome": {"$exists": False}}],
    }, {"_id": 1})
    if existing:
        return None
    return await audit(
        actor, action, target_type=target_type, target_id=target_id, metadata=metadata,
    )
