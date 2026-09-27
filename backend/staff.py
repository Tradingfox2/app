"""Staff (back-office) roles, permissions and the immutable audit trail.

Product roles (athlete / coach) stay separate from staff power: registration can
never set `staff_role`, and only an admin can grant it. Every staff action is
written to `audit_log` with an actor, a target and a reason.
"""
from __future__ import annotations

from typing import Literal

from fastapi import Depends, HTTPException

from server import current_user, db, new_id, now

StaffRole = Literal["support", "moderator", "admin"]

# Least privilege: each role inherits the one before it.
# Support owns the ticket queue and can read product analytics. Higher roles inherit both.
PERMISSIONS: dict[str, set[str]] = {
    "support": {"users.read", "reports.read", "audit.read", "analytics.read",
                "tickets.read", "tickets.write"},
    "moderator": {"users.read", "reports.read", "audit.read", "analytics.read",
                  "tickets.read", "tickets.write",
                  "reports.resolve", "content.moderate", "users.suspend"},
    "admin": {"users.read", "reports.read", "audit.read", "analytics.read",
              "tickets.read", "tickets.write",
              "reports.resolve", "content.moderate", "users.suspend", "staff.manage",
              "coaches.review"},
}
STAFF_ROLES = tuple(PERMISSIONS)


def permissions_for(user: dict) -> set[str]:
    return PERMISSIONS.get(user.get("staff_role") or "", set())


def is_staff(user: dict) -> bool:
    return bool(permissions_for(user))


def require(permission: str):
    """Dependency factory: 403 unless the caller's staff role grants `permission`."""
    async def guard(user: dict = Depends(current_user)) -> dict:
        if permission not in permissions_for(user):
            raise HTTPException(403, "Staff permission required")
        return user
    return guard


async def audit(actor: dict, action: str, *, target_type: str, target_id: str,
                reason: str | None = None, metadata: dict | None = None) -> dict:
    entry = {
        "id": new_id(),
        "actor_id": actor["id"],
        "actor_email": actor.get("email"),
        "actor_staff_role": actor.get("staff_role"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "reason": reason,
        "metadata": metadata or {},
        "created_at": now(),
    }
    await db.audit_log.insert_one(dict(entry))
    return entry
