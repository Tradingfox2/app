"""Community permissions: a bitmask per member, overridable per channel.

Two layers, the same shape Discord and Revolt converged on:

1. **Base grant** — the member's roles OR-ed together, always including the
   community's default ("everyone") role.
2. **Channel overwrites** — each channel may `deny` then `allow` bits for a
   role. Applied in ascending rank so a senior role wins the last word.

Community power is deliberately unrelated to `staff_role` in `staff.py`: owning
a community grants nothing on the platform, and platform staff get no seat in
someone's community. `VIEW_MEMBER_PROGRESS` exposes training volume only — the
health-data firewall over biomarkers, labs and DMs is not negotiable here.

Legacy documents carry `role` of "owner" / "moderator" / "member" and no
`role_ids`. `LEGACY` maps those onto the same bitmask, so this ships without a
migration.
"""
from __future__ import annotations

VIEW_CHANNEL = 1 << 0
SEND_MESSAGE = 1 << 1
ATTACH_MEDIA = 1 << 2
ADD_REACTION = 1 << 3
MENTION_EVERYONE = 1 << 4
PIN_MESSAGE = 1 << 5
MANAGE_MESSAGES = 1 << 6
MANAGE_CHANNEL = 1 << 7
INVITE_MEMBER = 1 << 8
KICK_MEMBER = 1 << 9
MANAGE_ROLES = 1 << 10
POST_PROGRAM = 1 << 11
START_LIVE_SESSION = 1 << 12
VIEW_MEMBER_PROGRESS = 1 << 13

PERMISSION_NAMES = (
    "VIEW_CHANNEL", "SEND_MESSAGE", "ATTACH_MEDIA", "ADD_REACTION",
    "MENTION_EVERYONE", "PIN_MESSAGE", "MANAGE_MESSAGES", "MANAGE_CHANNEL",
    "INVITE_MEMBER", "KICK_MEMBER", "MANAGE_ROLES", "POST_PROGRAM",
    "START_LIVE_SESSION", "VIEW_MEMBER_PROGRESS",
)

ALL = 0
for _name in PERMISSION_NAMES:
    ALL |= globals()[_name]

#: What a brand-new member can do: talk, react, bring a friend. Nothing destructive.
DEFAULT_MEMBER = (
    VIEW_CHANNEL | SEND_MESSAGE | ATTACH_MEDIA | ADD_REACTION | INVITE_MEMBER
)

#: Keeps the room clean; still cannot hand out roles or run live sessions.
MODERATOR = (
    DEFAULT_MEMBER | MENTION_EVERYONE | PIN_MESSAGE | MANAGE_MESSAGES
    | MANAGE_CHANNEL | KICK_MEMBER | VIEW_MEMBER_PROGRESS
)

#: What a timed-out member loses until the timeout lapses. Reading never is.
PARTICIPATE = (
    SEND_MESSAGE | ATTACH_MEDIA | ADD_REACTION | MENTION_EVERYONE
    | POST_PROGRAM | START_LIVE_SESSION
)

LEGACY: dict[str, int] = {
    "owner": ALL,
    "moderator": MODERATOR,
    "member": DEFAULT_MEMBER,
}


def has(mask: int, permission: int) -> bool:
    """True when every bit in `permission` is present in `mask`."""
    return mask & permission == permission


def describe(mask: int) -> list[str]:
    """Bit names set in `mask`, for audit entries and API responses."""
    return [name for name in PERMISSION_NAMES if has(mask, globals()[name])]


def _member_role_ids(member: dict, roles: list[dict]) -> list[str]:
    """The member's assigned roles plus the default role, ordered by rank."""
    assigned = set(member.get("role_ids") or [])
    applicable = [
        role for role in roles
        if role.get("id") in assigned or role.get("is_default")
    ]
    applicable.sort(key=lambda role: role.get("rank", 0))
    return [role["id"] for role in applicable]


def base_mask(member: dict, roles: list[dict]) -> int:
    """The member's grant before any channel overwrite is applied."""
    assigned = set(member.get("role_ids") or [])
    granted = 0
    matched = False
    for role in roles:
        if role.get("id") in assigned or role.get("is_default"):
            granted |= int(role.get("permissions", 0))
            matched = True
    # A legacy moderator keeps their powers even once custom roles exist, and a
    # community with no roles configured at all falls back entirely to `role`.
    legacy = LEGACY.get(member.get("role") or "member", DEFAULT_MEMBER)
    if not matched:
        return legacy
    return granted | (legacy if member.get("role") == "moderator" else 0)


def is_owner(member: dict, community: dict) -> bool:
    return (
        member.get("role") == "owner"
        or (member.get("user_id") is not None
            and member.get("user_id") == community.get("owner_id"))
    )


def resolve(
    member: dict,
    community: dict,
    channel: dict | None = None,
    roles: list[dict] | None = None,
) -> int:
    """Effective permission mask for `member`, optionally within `channel`.

    The owner short-circuits to `ALL` so a misconfigured overwrite can never
    lock someone out of the community they own.
    """
    if is_owner(member, community):
        return ALL

    roles = list(roles or [])
    mask = base_mask(member, roles)
    if not channel:
        return mask

    applicable = _member_role_ids(member, roles)
    overwrites = {
        overwrite.get("role_id"): overwrite
        for overwrite in (channel.get("overwrites") or [])
    }
    for role_id in applicable:  # ascending rank: the senior role speaks last
        overwrite = overwrites.get(role_id)
        if not overwrite:
            continue
        mask &= ~int(overwrite.get("deny", 0))
        mask |= int(overwrite.get("allow", 0))
    return mask


def highest_rank(member: dict, community: dict, roles: list[dict]) -> int:
    """Rank ceiling used to stop a member editing or assigning roles above them."""
    if is_owner(member, community):
        return 1 << 30
    assigned = set(member.get("role_ids") or [])
    ranks = [int(role.get("rank", 0)) for role in roles if role.get("id") in assigned]
    if not ranks and member.get("role") == "moderator":
        return 1  # legacy moderators outrank plain members but nothing else
    return max(ranks, default=0)
