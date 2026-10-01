"""Staff role names and the permission sets each role grants.

This module imports nothing from the app. `seed_scripts/grant_staff.py` reads
`STAFF_ROLES` from here. Importing them from `staff` instead loads `server`,
which loads `routers/admin.py`, which calls `staff.require` before `staff` has
finished initializing.
"""
from __future__ import annotations

from typing import Literal

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
              "coaches.review", "accounting.read"},
}
STAFF_ROLES = tuple(PERMISSIONS)
