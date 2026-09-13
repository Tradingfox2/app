# Community Social Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the IronFlow community from a forum-with-a-chatbox into a real social platform: custom roles with per-channel permission overwrites, full message interactions, realtime transport, mentions and notifications, automated moderation, and fitness-native channel types.

**Architecture:** A single pure-Python permission module (`backend/permissions.py`) becomes the authority for every community action, mirroring the proven shape of `backend/staff.py`. Permissions resolve as a bitmask: base role grants OR-ed together, then per-channel allow/deny overwrites applied in role-rank order. Legacy `owner`/`moderator`/`member` strings map onto the same bitmask so **no data migration is required**. Realtime is additive: Centrifugo owns the socket, FastAPI stays the source of truth and publishes after each successful write, degrading to a silent no-op when `CENTRIFUGO_URL` is unset.

**Tech Stack:** Python 3.14, FastAPI, Motor/MongoDB, Pydantic 2, PyJWT (already present), httpx (already present), pytest + pytest-xdist; Expo 54, React 19, React Native 0.81, TypeScript 5.9, Expo Router 6, Playwright.

**Spec:** Design agreed in session on 2026-09-13; this plan is self-contained.

## Global Constraints

- **No data migration.** Existing `community_members` documents carry `role` of `owner`, `moderator` or `member` and no `role_ids`. Resolution MUST fall back to a legacy mapping when `role_ids` is absent or empty.
- **No new backend dependency.** PyJWT and httpx are already in `backend/requirements.txt`. Detoxify is heavy (torch + transformers) and MUST be a lazy optional import behind a rule-based fallback.
- **No new frontend dependency without explicit approval** (CLAUDE.md rule). Build against existing primitives; recommend libraries separately.
- Centrifugo integration MUST degrade to a no-op when `CENTRIFUGO_URL` is unset, so tests and local dev run without the service.
- Owner always resolves to all permissions and can never be locked out of their own community.
- Staff `staff_role` powers stay entirely separate from community roles; a community owner gets no platform-staff power.
- The health-data firewall holds: `VIEW_MEMBER_PROGRESS` exposes training volume only, never biomarkers, lab results, or DM content.
- Every destructive moderation action keeps the existing reason-stamped audit trail (`backend/staff.py` `audit`).
- Soft-delete only: messages and channels move to `status` of `deleted`, never removed.
- Run backend tests with the worktree venv from `backend/`: `../.venv/Scripts/python.exe -m pytest -q`.

## Planned File Structure

### Backend

- Create `backend/permissions.py`: permission bit constants, legacy role mapping, `resolve()` and the `require_permission()` dependency factory. Pure logic.
- Create `backend/realtime.py`: Centrifugo connection-token minting and fire-and-forget publish; no-op when unconfigured.
- Create `backend/notifications.py`: generalised notification writes plus mention parsing.
- Create `backend/moderation.py`: content scoring with a rule-based default and optional Detoxify backend.
- Modify `backend/routers/community.py`: role CRUD, channel overwrites, message interactions, channel types; replace the inline role check at line 120 with the permission system.
- Modify `backend/server.py`: expose the realtime token endpoint.
- Create `backend/tests/test_permissions_unit.py`: pure resolution tests, no database.
- Create `backend/tests/test_community_permissions.py`: HTTP-level role and overwrite enforcement.
- Create `backend/tests/test_message_interactions.py`: reactions, replies, pins, edit, delete.

### Frontend

- Create `frontend/src/permissions.ts`: mirrored bit constants and a `can()` helper so the UI hides what the API would refuse.
- Modify `frontend/app/channel/[id].tsx`: message actions, reactions, reply composer, pinned drawer.
- Modify `frontend/app/community/[id]/manage.tsx`: role editor and per-channel permission matrix.

---

## Task 1: Permission bitmask and resolution

**Files:**
- Create: `backend/permissions.py`
- Test: `backend/tests/test_permissions_unit.py`

**Interfaces:**
- Produces: `resolve(member, community, channel, roles) -> int`, `has(mask, bit) -> bool`, `require_permission(bit)`, and bit constants `VIEW_CHANNEL`, `SEND_MESSAGE`, `ATTACH_MEDIA`, `ADD_REACTION`, `MENTION_EVERYONE`, `PIN_MESSAGE`, `MANAGE_MESSAGES`, `MANAGE_CHANNEL`, `INVITE_MEMBER`, `KICK_MEMBER`, `MANAGE_ROLES`, `POST_PROGRAM`, `START_LIVE_SESSION`, `VIEW_MEMBER_PROGRESS`, `ALL`, `DEFAULT_MEMBER`.

- [x] **Step 1: Write the failing tests** covering legacy member/moderator/owner mapping with no `role_ids`; custom roles OR-ing together; a channel overwrite deny stripping a base grant; an allow restoring it; owner bypassing every deny.
- [x] **Step 2: Run** `../.venv/Scripts/python.exe -m pytest tests/test_permissions_unit.py -q` — expect a collection error, module missing.
- [x] **Step 3: Implement** `backend/permissions.py`.
- [x] **Step 4: Run** the same command — expect all pass.
- [x] **Step 5: Commit** `feat: add community permission bitmask`.

## Task 2: Role CRUD

**Files:**
- Modify: `backend/routers/community.py`
- Test: `backend/tests/test_community_permissions.py`

**Interfaces:**
- Consumes: Task 1 `resolve`, `MANAGE_ROLES`.
- Produces: `GET/POST /communities/{id}/roles`, `PATCH/DELETE /roles/{role_id}`, `PUT /communities/{id}/members/{member_id}/roles`.

Rank rule: a member may never create, edit, or assign a role at or above their own highest rank. Owner is exempt.

- [x] Step 1: failing tests — a member without `MANAGE_ROLES` gets 403; rank escalation is refused; the default role cannot be deleted.
- [x] Steps 2-5 as in Task 1. Commit `feat: add community role management`.

## Task 3: Channel permission overwrites

**Files:**
- Modify: `backend/routers/community.py`

Overwrites embed on the channel document as `overwrites: [{role_id, allow, deny}]` — one document read, no join.

- [x] Step 1: failing tests — denying `SEND_MESSAGE` blocks posting while leaving reads intact; denying `VIEW_CHANNEL` hides the channel from list responses; the owner is unaffected.
- [x] Steps 2-5 as above. Commit `feat: add per-channel permission overwrites`.

## Task 4: Message interactions

**Files:**
- Modify: `backend/routers/community.py`
- Test: `backend/tests/test_message_interactions.py`

**Produces:** `POST/DELETE /messages/{id}/reactions`, `PATCH /messages/{id}`, `DELETE /messages/{id}`, `POST/DELETE /messages/{id}/pin`, `GET /channels/{id}/pins`, and `reply_to_id` on `MessageIn`.

Reactions embed on the message as `reactions: [{emoji, user_ids}]`, mutated with `$addToSet` and `$pull` so concurrent reactions cannot clobber each other. Edit is author-only within 15 minutes and stamps `edited_at`. Delete is author-or-`MANAGE_MESSAGES` and sets `status` to `deleted`, preserving the row.

- [x] Step 1: failing tests — double-reacting is idempotent; editing after 15 minutes is refused; a moderator can delete a member message but a peer cannot; replies resolve a parent preview; deleted messages leave listings but persist in the collection.
- [x] Steps 2-5 as above. Commit `feat: add message reactions, replies, pins and edits`.

## Task 5: Centrifugo realtime

**Files:**
- Create: `backend/realtime.py`
- Modify: `backend/server.py`, `backend/routers/community.py`

**Produces:** `connection_token(user_id) -> str`, `async publish(channel, data) -> None`, `GET /realtime/token`.

Channel naming: `community:{id}`, `channel:{id}`, `user:{id}`. Publishes are fire-and-forget — a Centrifugo outage must never fail the write that triggered it.

- [x] Step 1: failing tests — the token carries `sub` and `exp` and verifies against the configured secret; `publish` returns `None` without a request when `CENTRIFUGO_URL` is unset; a publish failure does not propagate out of message creation.
- [x] Steps 2-5 as above. Commit `feat: add Centrifugo realtime transport`.

## Task 6: Mentions and notification center

**Files:**
- Create: `backend/notifications.py`
- Modify: `backend/routers/community.py`, `backend/routers/social.py`

`parse_mentions(content)` extracts mention tokens; each resolved member gets a notification row and a `user:{id}` publish. An everyone-mention requires `MENTION_EVERYONE`.

- [x] Step 1: failing tests — mentioning everyone without the bit is silently dropped; a self-mention creates no notification; a notification marks read.
- [x] Steps 2-5 as above. Commit `feat: add mentions and notification center`.

## Task 7: Automated moderation

**Files:**
- Create: `backend/moderation.py`
- Modify: `backend/routers/community.py`, `backend/routers/social.py`

`score(text) -> float` uses Detoxify when installed and importable, else a rule-based fallback. Above threshold the content is **auto-reported into the existing staff queue, never auto-deleted** — a human keeps the final say.

- [x] Step 1: failing tests — the fallback scores clean text low and abusive text high; a high score files a report with reason `auto_flagged`; an import failure degrades silently.
- [x] Steps 2-5 as above. Commit `feat: add automated content moderation`.

## Task 8: Fitness-native channel types

**Files:**
- Modify: `backend/routers/community.py`

`ChannelIn.kind` is one of `text`, `announcement`, `program`, `challenge`, `checkin`, `live`, defaulting to `text`. An `announcement` channel denies `SEND_MESSAGE` to the default role on creation. A `checkin` channel enforces one message per member per UTC day.

- [x] Step 1: failing tests — announcement channels refuse member posts but accept moderator posts; a second same-day checkin is refused.
- [x] Steps 2-5 as above. Commit `feat: add fitness-native channel types`.

## Task 9: Frontend permission mirror and channel UI

**Files:**
- Create: `frontend/src/permissions.ts`
- Modify: `frontend/app/channel/[id].tsx`, `frontend/app/community/[id]/manage.tsx`
- Test: `frontend/e2e/community-permissions.spec.ts`

- [x] Step 1: failing Playwright test — a member without `SEND_MESSAGE` sees a read-only composer; the reaction bar appears on long-press; the role matrix saves allow and deny.
- [x] Steps 2-5 as above. Commit `feat: surface roles and message actions in the UI`.

---

## Status — 2026-09-13

**All 9 tasks complete.**

- Backend: 117 tests passing.
- Frontend: 44 e2e tests passing across desktop and mobile.
- Role editor and per-channel permission matrix shipped in
  `community/[id]/manage.tsx`.
- Realtime is wired end to end: `frontend/src/realtime.ts` connects via the
  `centrifuge` SDK (the one new dependency, approved 2026-09-13). With realtime
  up the poll drops from 8s to a 45s reconcile; with it down or disabled the
  8s poll continues unchanged.

### Deviations from the plan worth recording

1. Task 8 originally created an announcement channel by writing a
   `SEND_MESSAGE` deny overwrite against the @everyone role. That muted legacy
   moderators too, because they inherit the default role and have no role
   document to grant an exception to. Replaced with a direct permission
   requirement: posting to an `announcement` channel needs `MANAGE_MESSAGES`.
   Lesson: do not model a capability as a deny when some actors are not
   represented as roles.

2. Consolidating the management screen's single-flight handlers into one `run`
   helper silently changed the channel-ranking error copy from a generic string
   to the server's detail, which `community.spec.ts` pins. Restored via an
   opt-in `generic` flag. Showing the server reason may be better UX, but that
   is a product decision, not a refactor side effect.

3. Centrifugo is not available in CI, so the realtime e2e tests drive the client
   against a mocked socket using Playwright's `routeWebSocket` and Centrifugo's
   newline-delimited JSON framing. This verifies connect, subscribe and
   publication handling for real rather than assuming them.

## Deploying Centrifugo

Centrifugo OSS is Apache-2.0 and free for commercial self-hosting. PRO adds push
notifications, ClickHouse analytics and rate limiting — none of which this needs.

Backend environment variables (all optional; absent means realtime stays off and
the client keeps polling):

```
CENTRIFUGO_URL=http://127.0.0.1:8000
CENTRIFUGO_API_KEY=<api key from centrifugo config>
CENTRIFUGO_TOKEN_SECRET=<token hmac secret>   # defaults to JWT_SECRET
CENTRIFUGO_TOKEN_TTL=3600
```

Centrifugo's own `config.json` needs the matching `token_hmac_secret_key` and
`api_key`. The client fetches `GET /api/realtime/token` and connects; when the
response says `enabled: false` it falls back to the existing 8-second poll.

## Optional moderation model

```
MODERATION_BACKEND=rules      # or "detoxify"
MODERATION_THRESHOLD=0.8
DETOXIFY_MODEL=multilingual   # en/fr/es/it/pt/tr/ru
```

`detoxify` requires `pip install detoxify` (pulls torch + transformers, ~2GB).
Left out of `requirements.txt` deliberately; the rule-based scorer runs until
it is installed, and the switch needs no code change.
