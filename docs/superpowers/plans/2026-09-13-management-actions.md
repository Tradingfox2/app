# Management Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap between what the backend can do and what a user can actually click, for community, channel, member, coach and staff management.

**Architecture:** Three shapes of gap, each fixed differently. Where the endpoint and client exist but no button does, add the button. Where the endpoint exists but the client does not, add both. Where neither exists (channel rename/archive, community archive), add the endpoint behind the existing permission bits, then the client, then the button. No new permission concepts: everything reuses `MANAGE_CHANNEL`, `KICK_MEMBER`, `MANAGE_ROLES` and the staff `coaches.review` permission already defined.

**Tech Stack:** Python 3.14, FastAPI, Motor/MongoDB, Pydantic 2, pytest; Expo 54, React 19, TypeScript 5.9, Expo Router 6, Playwright.

**Spec:** Audit performed 2026-09-13 against 118 backend routes and 113 client methods; the gap matrix is reproduced below.

## Global Constraints

- Soft delete only: channels and communities move to `status` of `archived`, never removed. Messages already follow this.
- Destructive staff and moderation actions keep the reason-stamped audit entry via `staff.audit`.
- An owner can never be removed from, or banned in, their own community.
- Archiving a channel must not orphan its messages; they stay readable to anyone who can still view the channel.
- Reuse existing permission bits. Do not invent new ones.
- No new dependency, frontend or backend.
- Run backend tests from `backend/` with `../.venv/Scripts/python.exe -m pytest -q`.

## Gap Matrix

| Capability | Backend | Client | Button | Task |
|---|---|---|---|---|
| Review coach applications | yes | no | no | 1 |
| Edit community settings | yes | no | no | 2 |
| Leave community | yes | yes | no | 3 |
| Remove / ban an active member | yes | yes | no | 3 |
| Staff note on a user | yes | yes | no | 4 |
| Rename / archive a channel | no | no | no | 5 |
| Archive a community | no | no | no | 6 |

## Planned File Structure

### Backend
- Modify `backend/routers/community.py`: channel rename/archive, community archive, member removal guard.
- Create `backend/tests/test_management_actions.py`: coverage for every new endpoint and guard.

### Frontend
- Modify `frontend/src/api.ts`: `coachApplications`, `reviewCoachApplication`, `updateCommunity`, `updateChannel`, `archiveChannel`, `archiveCommunity`.
- Modify `frontend/app/admin/index.tsx`: a Coaches tab for the application queue.
- Modify `frontend/app/community/[id]/manage.tsx`: community settings form, channel rename/archive, member removal, archive community.
- Modify `frontend/app/community/[id].tsx`: leave-community button.
- Create `frontend/e2e/management.spec.ts`: browser coverage for the new buttons.

---

## Task 1: Coach application review

**Files:** Modify `frontend/src/api.ts`, `frontend/app/admin/index.tsx`; test `frontend/e2e/management.spec.ts`.

The endpoints `GET /admin/coach-applications` and `PATCH /admin/coach-applications/{id}` already exist and are permission-gated on staff `coaches.review`. Nothing in the app calls them, so coach onboarding currently has no exit: members apply and the queue grows unread.

- [ ] Step 1: Failing Playwright test — a staff member with `coaches.review` sees the pending queue, approves one, and it leaves the list; a moderator without the permission sees a read-only notice.
- [ ] Step 2: Run, expect fail. Step 3: add `coachApplications()` and `reviewCoachApplication(id, status, note)` to the client, plus a Coaches tab in the console. Step 4: run, expect pass. Step 5: commit.

## Task 2: Edit community settings

**Files:** Modify `frontend/src/api.ts`, `frontend/app/community/[id]/manage.tsx`.

`PATCH /communities/{id}` accepts name, description, is_public, join_policy, price_cents and currency, and is gated on `_manager`. There is no client method, so a community's name and join policy are frozen at creation.

- [ ] Step 1: Failing test — editing the name and switching join policy persists and re-renders; a member without `MANAGE_CHANNEL` never sees the form.
- [ ] Steps 2-5 as above. Commit `feat: edit community settings`.

## Task 3: Leave a community, and remove a member

**Files:** Modify `frontend/app/community/[id].tsx`, `frontend/app/community/[id]/manage.tsx`.

`api.leaveCommunity` exists with no caller. `reviewCommunityMember` accepts `banned` but the UI only ever offers approve/reject on pending rows, so an active member can never be removed.

- [ ] Step 1: Failing test — a member sees Leave and the call fires; an owner does not see Leave in their own community; a manager can remove an active member but never the owner.
- [ ] Steps 2-5 as above. Commit `feat: leave community and remove members`.

## Task 4: Staff note on a user

**Files:** Modify `frontend/app/admin/index.tsx`.

`api.adminAddNote` exists with no caller, and the user detail already renders `notes`, so the console displays notes it gives no way to write.

- [ ] Step 1: Failing test — a moderator adds a note and it appears in the detail panel.
- [ ] Steps 2-5 as above. Commit `feat: add staff notes from the console`.

## Task 5: Rename and archive a channel

**Files:** Modify `backend/routers/community.py`, `frontend/src/api.ts`, `frontend/app/community/[id]/manage.tsx`; test `backend/tests/test_management_actions.py`.

Neither endpoint exists. Both gate on `MANAGE_CHANNEL`.

- [ ] Step 1: Failing tests — rename normalises the slug the same way creation does; archiving hides the channel from listings but keeps its messages readable; the default channel cannot be archived; a member without the permission gets 403.
- [ ] Steps 2-5 as above. Commit `feat: rename and archive channels`.

## Task 6: Archive a community

**Files:** Modify `backend/routers/community.py`, `frontend/src/api.ts`, `frontend/app/community/[id]/manage.tsx`.

`_community_or_404` already refuses anything whose `status` is not `active`, so archiving is a one-field write that the read path honours. Owner only — a moderator must not be able to close someone's community.

- [ ] Step 1: Failing tests — the owner archives and the community 404s afterwards; a moderator with `MANAGE_CHANNEL` is refused; the action is audited.
- [ ] Steps 2-5 as above. Commit `feat: archive a community`.
