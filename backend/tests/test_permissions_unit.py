"""Pure resolution tests for community permissions — no database, no FastAPI.

The resolution order is the whole contract: owner short-circuits, then base role
grants OR together, then per-channel overwrites apply deny-before-allow in
ascending role rank.
"""
import permissions as p


OWNER_ID = "owner-1"
COMMUNITY = {"id": "c-1", "owner_id": OWNER_ID}


def member(uid="u-1", role="member", role_ids=None):
    return {"user_id": uid, "role": role, "role_ids": role_ids or [], "status": "active"}


def role(rid, rank, perms, is_default=False):
    return {"id": rid, "community_id": "c-1", "name": rid, "rank": rank,
            "permissions": perms, "is_default": is_default}


def channel(overwrites=None):
    return {"id": "ch-1", "community_id": "c-1", "overwrites": overwrites or []}


# --- Legacy compatibility: existing documents carry no role_ids at all. ---

def test_legacy_member_gets_the_default_grant():
    mask = p.resolve(member(), COMMUNITY, None, [])
    assert p.has(mask, p.SEND_MESSAGE)
    assert p.has(mask, p.VIEW_CHANNEL)
    assert not p.has(mask, p.MANAGE_MESSAGES)
    assert not p.has(mask, p.MANAGE_ROLES)


def test_legacy_moderator_can_moderate_but_not_manage_roles():
    mask = p.resolve(member(role="moderator"), COMMUNITY, None, [])
    assert p.has(mask, p.MANAGE_MESSAGES)
    assert p.has(mask, p.PIN_MESSAGE)
    assert p.has(mask, p.KICK_MEMBER)
    assert not p.has(mask, p.MANAGE_ROLES)


def test_legacy_owner_gets_everything():
    assert p.resolve(member(uid=OWNER_ID, role="owner"), COMMUNITY, None, []) == p.ALL


def test_owner_is_recognised_by_id_even_if_the_role_string_is_wrong():
    mask = p.resolve(member(uid=OWNER_ID, role="member"), COMMUNITY, None, [])
    assert mask == p.ALL


# --- Custom roles ---

def test_assigned_roles_or_together_with_the_default_role():
    roles = [
        role("everyone", 0, p.VIEW_CHANNEL, is_default=True),
        role("coach", 5, p.POST_PROGRAM),
        role("helper", 3, p.MANAGE_MESSAGES),
    ]
    mask = p.resolve(member(role_ids=["coach", "helper"]), COMMUNITY, None, roles)
    assert p.has(mask, p.VIEW_CHANNEL)   # from the default role
    assert p.has(mask, p.POST_PROGRAM)
    assert p.has(mask, p.MANAGE_MESSAGES)
    assert not p.has(mask, p.KICK_MEMBER)


def test_default_role_applies_even_when_unassigned():
    roles = [role("everyone", 0, p.VIEW_CHANNEL | p.SEND_MESSAGE, is_default=True)]
    mask = p.resolve(member(role_ids=[]), COMMUNITY, None, roles)
    assert p.has(mask, p.SEND_MESSAGE)


# --- Channel overwrites ---

def test_channel_deny_strips_a_base_grant():
    roles = [role("everyone", 0, p.VIEW_CHANNEL | p.SEND_MESSAGE, is_default=True)]
    ch = channel([{"role_id": "everyone", "allow": 0, "deny": p.SEND_MESSAGE}])
    mask = p.resolve(member(), COMMUNITY, ch, roles)
    assert p.has(mask, p.VIEW_CHANNEL)
    assert not p.has(mask, p.SEND_MESSAGE)


def test_higher_ranked_allow_restores_what_a_lower_rank_denied():
    roles = [
        role("everyone", 0, p.VIEW_CHANNEL | p.SEND_MESSAGE, is_default=True),
        role("coach", 5, 0),
    ]
    ch = channel([
        {"role_id": "everyone", "allow": 0, "deny": p.SEND_MESSAGE},
        {"role_id": "coach", "allow": p.SEND_MESSAGE, "deny": 0},
    ])
    assert not p.has(p.resolve(member(), COMMUNITY, ch, roles), p.SEND_MESSAGE)
    coach_mask = p.resolve(member(role_ids=["coach"]), COMMUNITY, ch, roles)
    assert p.has(coach_mask, p.SEND_MESSAGE)


def test_overwrites_for_roles_the_member_lacks_are_ignored():
    roles = [
        role("everyone", 0, p.VIEW_CHANNEL | p.SEND_MESSAGE, is_default=True),
        role("muted", 1, 0),
    ]
    ch = channel([{"role_id": "muted", "allow": 0, "deny": p.SEND_MESSAGE}])
    assert p.has(p.resolve(member(), COMMUNITY, ch, roles), p.SEND_MESSAGE)


def test_owner_bypasses_every_deny():
    roles = [role("everyone", 0, p.VIEW_CHANNEL, is_default=True)]
    ch = channel([{"role_id": "everyone", "allow": 0, "deny": p.ALL}])
    assert p.resolve(member(uid=OWNER_ID, role="owner"), COMMUNITY, ch, roles) == p.ALL


def test_legacy_moderator_still_loses_a_denied_channel_bit():
    # Legacy roles must interact with overwrites through the default role too.
    roles = [role("everyone", 0, p.DEFAULT_MEMBER, is_default=True)]
    ch = channel([{"role_id": "everyone", "allow": 0, "deny": p.SEND_MESSAGE}])
    mask = p.resolve(member(role="moderator"), COMMUNITY, ch, roles)
    assert not p.has(mask, p.SEND_MESSAGE)
    assert p.has(mask, p.MANAGE_MESSAGES)


# --- Invariants ---

def test_default_member_is_a_strict_subset_of_moderator_and_all():
    assert p.DEFAULT_MEMBER & p.MODERATOR == p.DEFAULT_MEMBER
    assert p.MODERATOR & p.ALL == p.MODERATOR
    assert p.DEFAULT_MEMBER != p.MODERATOR


def test_dangerous_bits_are_never_in_the_default_grant():
    for bit in (p.MANAGE_ROLES, p.KICK_MEMBER, p.MANAGE_MESSAGES, p.MANAGE_CHANNEL):
        assert not p.has(p.DEFAULT_MEMBER, bit)


def test_every_named_bit_is_distinct_and_inside_all():
    bits = [getattr(p, name) for name in p.PERMISSION_NAMES]
    assert len(set(bits)) == len(bits)
    for bit in bits:
        assert p.ALL & bit == bit
