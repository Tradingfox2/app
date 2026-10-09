# IronFlow staff console — audit

Date: 2026-10-09. Baseline commit: `2b2fef0` (`Separate staff admin site`). Branch that implements the ranked fixes: `cursor/admin-console-audit-9d72`.

This document is the Stage 1 audit. Rows marked **fixed on this branch** were verified in code and tests after the audit. Figures in the operations mockup are illustrative. The console does not claim legal compliance.

There is no `AGENTS.md` in this repository. Ground truth came from `README.md`, `design_guidelines.json`, `frontend/src/theme.ts`, and the files named in the review request.

## How the audit was checked

Product, backend, security, frontend-state, and QA passes read the same files and disagreed where the code disagreed with the initial notes. A claim is recorded only when a file, function, or test shows it. Baseline before these edits, on `2b2fef0`:

- `pytest tests/test_admin_console.py tests/test_accounting.py tests/test_permissions_unit.py` — 23 passed.
- `npx tsc --noEmit` in `frontend/` — exit 0.
- Full `pytest` and `expo lint` were not part of that baseline.

`tests/test_permissions_unit.py` covers community permission bits, not staff roles.

## Architecture

```
frontend/staff/index.tsx          Expo Router staff root (IRONFLOW_WEB_TARGET=staff)
  staff/auth.tsx                  Sign-in. Product role "admin" is not a staff role.
  staff/_layout.tsx               Staff shell
  src/api.ts                      /api client. staffPage() accepts a legacy array or {rows,total,next_cursor}
  src/components/admin/operations-overview.tsx
  src/components/admin/page-footer.tsx
  src/components/admin/accounting-panel.tsx
  src/components/admin/analytics-panel.tsx
        │  Bearer JWT (user id only)
        ▼
backend/routers/admin.py          overview, users, reports, memberships, communities, coaches, audit
backend/routers/tickets.py        staff ticket list (cursor, unassigned)
backend/staff.py + staff_roles.py permission check on every request
backend/accounting.py             currency buckets; never summed across currencies
backend/server.py lifespan        Mongo indexes (not SQL migrations)
Mongo collections                 users, reports, audit_log, tickets, community_members, communities,
                                  coach_applications, user_notes
```

Staff role inclusion is `support ⊂ moderator ⊂ admin` (`backend/staff_roles.py`). The product field `users.role` does not grant staff permissions. `current_user` reloads the account on each request, so a permission change applies to the next API call. The console UI reloads overview on focus and on web `visibilitychange`.

Design tokens in use are `frontend/src/theme.ts`: background `#101418`, surface `#1A1F24`, brand `#D6E35A` for the selected tab and queue links. `design_guidelines.json` still documents the older `#121212` / `#D4FF00` pair. This console follows `theme.ts`.

## Feature matrix

| Feature | UI location | API endpoint | Permission | Data source | Mutation | Audit coverage | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Operations overview | `staff/index.tsx` + `operations-overview.tsx` | `GET /admin/overview`, `GET /health` | `users.read` (overview). Health is the public health route, read after the staff gate. | `count_documents` on users, reports, tickets, applications, memberships | No | No | `test_overview_and_user_search`; e2e overview + health | **Fixed on this branch:** metric cards link to queues; Healthy only when health says `status=ok` and `mongo=true`. |
| Open reports | Reports tab | `GET /admin/reports` | `reports.read` | `reports` | No | No | `test_open_reports_sort_by_urgency_then_age`; e2e report type chips | **Fixed:** cursor page, urgency then age, total. Client type chip still filters the loaded page so a mock that ignores `target_type` stays correct. |
| Resolve report | Reports tab | `PATCH /admin/reports/{id}` | `reports.resolve` | `reports` | Yes | `report.{resolution}` with from/to | `test_report_flow_snapshots_content_and_resolves_once`; `test_user_suspended_resolution_suspends_and_a_moderator_cannot_suspend_staff` | **Fixed:** conditional `status:open` update; `user_suspended` suspends via the same staff guard; UI offers SUSPEND when a reported account exists. |
| Users search | Users tab | `GET /admin/users` | `users.read` | `users` | No | No | `test_user_pages_expose_the_total_and_do_not_repeat`; e2e search | **Fixed:** cursor + filtered total. `count` remains the page length. |
| Suspend / reinstate | User detail | `POST /admin/users/{id}/suspend`, `.../reinstate` | `users.suspend`; staff targets also need `staff.manage` | `users` | Yes | `user.suspended`, `user.reinstated` with from/to | `test_suspension_blocks_access_and_expires`; reinstate test | **Fixed:** moderator cannot reinstate staff. |
| Staff role | User detail | `PATCH /admin/users/{id}/staff-role` | `staff.manage` | `users.staff_role` | Yes | `staff.role_changed` from/to | `test_staff_role_changes_are_admin_only_and_audited` | Self-change is 409. A last-admin lockout is not reachable: only an admin can change roles, and that admin cannot change their own. |
| Staff notes | User detail | `POST /admin/users/{id}/notes` | `users.read` | `user_notes` | Yes | Not written to `audit_log` | Covered indirectly by user detail | Accepted: support writes notes as part of `users.read`. Not a secret channel. |
| Support queue | Support tab | `GET /admin/tickets` | `tickets.read` | `tickets` | No | No | `tests/test_support_tickets.py`; e2e queue | **Fixed:** `total`, `next_cursor`, `unassigned=true`. `count` stays the page length. |
| Ticket reply / status | Ticket thread | `POST /admin/tickets/{id}/messages`, `PATCH /admin/tickets/{id}` | `tickets.write` | `ticket_messages`, `tickets` | Yes | Not audited | e2e reply + status | Reply bodies are the support channel, not product DMs. Audit of replies is still open. |
| Memberships | Memberships tab | `GET/PATCH /admin/memberships` | read `users.read`; review `content.moderate` | `community_members` | Yes | `membership.reviewed` from/to | `test_membership_review_hides_stripe_ids`; e2e waiting copy | **Fixed:** cursor, oldest first, stripe ids omitted from the response, conditional pending update. |
| Communities | Communities tab | `GET /admin/communities` | `users.read` | `communities` + member counts | No | No | e2e community row | **Fixed:** envelope, cursor, batched counts. |
| Coaches | Coaches tab stays in the nav. The list is fetched only with `coaches.review`; otherwise the tab is an empty read-only queue. | `GET /admin/coaches`, review routes | `coaches.review` | `coach_applications`, `users` | Yes | review actions audited | `management.spec.ts` approves an application and checks the read-only tab | **Open:** hard cap 100, `next_cursor` is null. The footer says when `total` is larger. The tab is not the security boundary. |
| Audit log | Audit tab | `GET /admin/audit-log` | `audit.read` | `audit_log` | No write route | The log itself | `test_audit_log_filters_and_pages`; e2e row text | **Fixed:** actor, action prefix, target, date, cursor. Failed requests are not stored, so there is no separate failure outcome. |
| Analytics | Analytics tab | `GET /admin/analytics` | `analytics.read` | `analytics_events` | No | `analytics.viewed` on each view | existing panel | View audit is noisy. Left as-is. |
| Accounting | Accounting tab | `GET /admin/accounting/summary` | `accounting.read` | accounting collections | No | `accounting.viewed` | `tests/test_accounting.py`; e2e currencies + missing `subscription_amounts` | **Fixed on the client:** missing `subscription_amounts` renders an incomplete state. Backend already refuses to sum currencies. |
| System status | Overview card | `GET /health` | Staff shell already passed `users.read` | Mongo ping | No | No | e2e unverified vs Healthy | Unverified is not shown as Healthy. No invented security-alert feed. |

## Findings

### F1 — One screen owns most staff tasks

- Severity: medium. Confidence: high.
- File: `frontend/staff/index.tsx` (`AdminConsole`). Analytics and accounting were already separate panels.
- Existing: eleven tabs, their fetches, and their dialogs live in one component.
- Expected: domain modules, one loading and error pattern, navigation that follows the task.
- Evidence: the component still holds reports, users, joins, communities, coaches, team, support, and audit. Overview moved to `operations-overview.tsx`. Shared page copy lives in `page-footer.tsx`.
- Root cause: the staff site was added as one route.
- Impact: a change in one queue risks the others. Loading used to be one `error` string for every section.
- Fix on this branch: overview module, page footer, per-section errors for reports, users, and audit (`Promise.allSettled`). Further splits are the next phase.
- Tests: `npx tsc --noEmit`; e2e `admin.spec.ts`.

### F2 — Capped lists hid the rest of the collection

- Severity: high. Confidence: high.
- Files: `backend/routers/admin.py` `list_users`, `list_reports`, `list_memberships`, `list_communities`, `audit_log`; `backend/routers/tickets.py` `list_for_staff`.
- Existing: handlers stopped at 25–100 rows (audit 200). User and ticket `count` was the page length. The client filtered that page and could present it as the queue.
- Expected: server cursor, filtered total, stable sort, and copy that says when the page is short of the total.
- Evidence: `test_user_pages_expose_the_total_and_do_not_repeat` and `test_open_reports_sort_by_urgency_then_age` fail on the old handlers (they now pass). `count` is still the page length because `tests/test_support_tickets.py` asserts that.
- Root cause: list endpoints were built as previews.
- Impact: staff could miss a report, a member, or an audit row past the cap.
- Fix: opaque cursor in `backend/admin_pages.py`. Responses add `total` and `next_cursor`. Open reports sort by urgency (violence, sexual_content, dangerous_advice, harassment, spam, other) then `created_at`, then id. `PageFooter` says `Showing {loaded} of {total}` or, when `total` is null, that the list may be incomplete.
- Tests: the two tests above, `test_audit_log_filters_and_pages`, support ticket tests.

### F3 — Overview counts did not show age, failures, or a verified status

- Severity: medium. Confidence: high.
- Files: `GET /admin/overview`; previously inline metrics in `staff/index.tsx`.
- Existing: counts linked to tabs. They did not show oldest-open age, unassigned tickets, or a health check. A missing health payload could be read as fine.
- Expected: the operations layout — four primary cards plus a priority queue — using the existing dark theme. Healthy only when a health check says so.
- Evidence: overview now returns `unassigned_open_tickets`, `oldest_open_report_at`, `oldest_unassigned_ticket_at`, `generated_at`. `api.adminHealth` returns `phase: "unverified"` unless `status === "ok"` and `mongo === true`. The default e2e mock answers unknown paths with `[]`, and the card stays Unverified.
- Root cause: the first overview was a count strip.
- Impact: a queue could look current while the oldest row sat for days, and a failed health check had no place to appear.
- Fix: `operations-overview.tsx`. Stock and last-24-hours blocks stay, because those counts mean different things and the e2e test checks their order.
- Tests: e2e `overview keeps community stock out of the last 24 hours`, `system status is Healthy only when the health check verified it`, `a verified health check shows Healthy`.

### F4 — Two moderation paths did not enforce the permission they displayed

- Severity: high. Confidence: high.
- Files: `review_report`, `reinstate_user`, `review_membership` in `backend/routers/admin.py`.
- Existing: `user_suspended` resolved a report and did not suspend the account. A moderator with `users.suspend` could reinstate a staff account. Membership review returned Stripe customer and subscription ids. Two reviewers could both pass the “still open” read.
- Expected: the same staff guard as the suspend button; no payment identifiers in the staff response; one winner for a report or a pending membership.
- Evidence: `test_user_suspended_resolution_suspends_and_a_moderator_cannot_suspend_staff` (422 on a short note, 403 for a staff target, report stays open). `test_moderator_cannot_reinstate_staff_and_last_admin_stays`. `test_membership_review_hides_stripe_ids` (ids remain stored, they are absent from the response).
- Root cause: the resolution enum was wider than the code path, and the membership serializer reused the stored document.
- Impact: a moderator could think an account was suspended when it was not, or could restore a suspended staff account. Stripe ids do not belong on a moderation screen.
- Fix: `_staff_guard` runs before the report is claimed. The claim is the conditional `update_one` on `{id, status: "open"}`. Suspension and content removal run only after `modified_count == 1`. A lost claim does not suspend. The winning resolution is not reopened if a later write fails, because reopening would allow a second decision on top of a suspension that already landed. Pending memberships use the same conditional update. The Coaches tab stays visible (the management e2e opens it without `coaches.review` and expects an empty read-only list). The route still requires `coaches.review` before it returns applications.
- Tests: the three tests named above.

### F5 — Audit search ran on a short page

- Severity: high. Confidence: high.
- File: `audit_log`; previously a client haystack over the newest rows.
- Existing: the API accepted `actor_id` and `target_id` only. The screen filtered the loaded page locally.
- Expected: server filters for actor, action, target, date, and recorded outcome, plus pagination and before/after on sensitive changes, with no secrets. The log stays read-only.
- Evidence: `test_audit_log_filters_and_pages` filters `action` prefix `user.`, actor email, and an exclusive `to`. Role and reinstatement metadata store `from` and `to`. There is still no POST/PATCH/DELETE on `/admin/audit-log`.
- Root cause: the journal was a tail, and the filter was painted on top.
- Impact: an action older than the cap could not be found, and a local filter looked complete.
- Fix: actor id or escaped email regex, action prefix, target type/id, `from` inclusive / `to` exclusive, cursor. The screen shows `from → to` when both are strings. It does not dump the rest of `metadata`. The client sends the selected end date as the next UTC midnight because `to` is exclusive.
- Residual: a failed request is not an audit row. The action name is the recorded outcome. Filtering “failures” would invent rows the server does not write.
- Tests: `test_audit_log_filters_and_pages`; e2e still expects `user.suspended`, `sam@example.invalid → user:u-1`, and `Repeated harassment`.

### F6 — One failed call blanked the console

- Severity: medium. Confidence: high.
- Files: `staff/index.tsx` `load`; `accounting-panel.tsx`; `analytics-panel.tsx`.
- Existing: overview, reports, users, and audit were one `try`. A failure set a single `error` and skipped the rest. Search and the two panels had no request generation, so a slow response could replace a newer one.
- Expected: empty, failed, and incomplete are different. Last-updated is visible. Retry is scoped. A stale response does not win.
- Evidence: `load` uses `revision` and `Promise.allSettled`. Section errors render on overview and on the reports, users, and audit tabs. Both panels keep a request id and ignore an older response. Overview shows `generated_at` or says the payload had no update time.
- Root cause: one async function owned every section.
- Impact: a failed audit call could hide a good overview, and a slow period change could paint the previous period.
- Residual: ticket, membership, and community tab errors still use the shared `error` line. Mutations are serialized with `busy`, so a second click while one is running is ignored rather than applied out of order.
- Tests: panel behavior is covered by the accounting e2e (the panel still renders). A dedicated stale-response unit test is not in the repo.

### F7 — Accounting crashed when a section was absent

- Severity: high. Confidence: high.
- File: `frontend/src/components/admin/accounting-panel.tsx`.
- Existing: the panel read `subscription_amounts.stripe` with no guard. A summary that omitted the key threw `Cannot read properties of undefined (reading 'stripe')`.
- Expected: gross, fees, refunds, chargebacks, and liabilities stay distinct; currencies are never added; a missing section is incomplete, not zero.
- Evidence: `backend/accounting.py` on `2b2fef0` already returns `subscription_amounts` and does not add JPY to USD. The crash is the client assuming that shape. `asBucket` / `asCounts` map a missing value to `state: "unavailable"`. The incomplete line uses test id `accounting-subscriptions-incomplete`.
- Root cause: the client trusted a partial JSON body.
- Impact: the accounting tab did not open against an older or partial payload, which looks like “there is no money data”.
- Fix: optional access plus the incomplete sentence. Amounts that are present still render per currency.
- Tests: e2e `accounting stays up when subscription amounts are missing`; existing currency e2e still expects `$12.50` and `¥500,000` apart.

### F8 — Windows `preinstall` invoked the shell script directly

- Severity: medium. Confidence: high.
- File: `frontend/package.json`.
- Existing: `preinstall` ran `./scripts/cmd-guard.js --preinstall`, which Windows cannot execute as a script.
- Expected: `node ./scripts/cmd-guard.js --preinstall`.
- Evidence: the script is a Node file. The `preinstall` string is now the `node` form. Linux `yarn install` already succeeds with that command.
- Impact: a Windows install stopped before dependencies.
- Tests: not run on Windows in this environment. The command is the one the script’s `--preinstall` flag already implements.

### F9 — Staff list queries scanned without a matching index

- Severity: medium. Confidence: medium (the missing indexes are visible; production explain output is not).
- File: `backend/server.py` lifespan.
- Existing: list sorts on `created_at`/`updated_at` plus status or actor did not all have a compound index.
- Expected: indexes that match the new sorts.
- Fix: indexes on `audit_log` `(actor_id, created_at)` and `(action, created_at)`; `users` `(created_at, id)` and `(staff_role, created_at)`; coach applications, memberships, and communities by the list sort; reports `(status, created_at, id)`; tickets `(status, updated_at)` and `(assignee_id, status, updated_at)`.
- These are created at process start, same as the other Mongo indexes. There is no SQL migration.
- People and community counts on report, membership, and community pages are batched with `$in` instead of one query per row.

### F10 — Some successful mutations left the screen on the old row

- Severity: medium. Confidence: high.
- File: `staff/index.tsx`.
- Existing: resolving a report did not decrement `open_reports`. Changing a staff role did not update the user or team row until the next full load. Focus reload reset report and user filters.
- Fix: those mutations update the lists and the matching totals, then reload the audit page. `filtersRef` is what focus reload uses, so a return to the tab keeps the current search. Web `visibilitychange` reloads permissions from the server.

## Rejected hypotheses

| Hypothesis | Result | Why |
| --- | --- | --- |
| Dashboard counts are computed wrong and diverge from the database | Rejected | `GET /admin/overview` uses `count_documents`. A mismatch with a list was the list cap, not the count. |
| The accounting summary adds currencies or presents an incomplete period as a total | Rejected | Buckets are per currency. Incomplete sections use `unavailable` or `none_in_period`. The client crash was a missing key, not a mixed total. |
| The JWT caches staff permissions for the life of the token | Rejected | The token is the user id. `current_user` loads the account per request. |
| Admin routes are reachable without a staff permission | Rejected | Each handler uses `staff.require(...)`. The e2e signed-out test expects the auth screen. |
| User detail returns biomarkers or lab reports | Rejected | `ACCOUNT_FIELDS` omits them. `test_user_detail_never_exposes_health_data` asserts that. |
| Hiding a tab is what stops the action | Rejected | Coaches, analytics, accounting, and support tabs follow the permission list, and the routes check it again. |
| The client can write the audit log | Rejected | The only audit route is `GET`. |
| Caps exist only in the client | Rejected | The limits are in the handlers (`limit` query, coaches `limit(100)`). |
| A secondary failure was silent | Rejected as “silent” | The old `load` set `error`. It did drop the other sections, which F6 fixes. |
| Removing your own admin role can lock the staff out of `staff.manage` | Rejected | `set_staff_role` returns 409 when the target is the actor. Only admins hold `staff.manage`, so they cannot demote the last admin by demoting themselves. |

## Privacy

Staff account reads use `ACCOUNT_FIELDS` (identity, role, suspension). They do not include biomarkers or lab documents.

A direct message body reaches the console only as `content_snapshot` on a report, and only when the recipient reported that message (`create_report` in `admin.py`). The overview copy says reported content is shown only on a report. It does not say private messages are never shown, because that snapshot is the exception the product already defined.

Support ticket bodies are the support thread the member opened. They are not product DM bodies.

Membership responses no longer include `stripe_customer_id` or `stripe_subscription_id`. The stored documents still have them.

Audit metadata shown in the UI is limited to string `from` and `to`.

## Ranked backlog

Acceptance criteria are what a later change has to prove. Items already done on this branch are marked.

### P0 — security and correctness

1. **Done.** `user_suspended` suspends the reported account, refuses a note under 10 characters, and a moderator cannot suspend staff. The report stays open when the guard fails.
2. **Done.** Report and pending-membership updates match `status` so a second writer gets 409.
3. **Done.** Reinstating staff requires `staff.manage`.
4. **Done.** Membership review response has no Stripe ids.
5. **Done.** Accounting renders when `subscription_amounts` is missing.
6. **Done.** `preinstall` is `node ./scripts/cmd-guard.js --preinstall`.

### P1 — pages, filters, races, indexes

1. **Done** for users, reports, memberships, communities, audit, tickets. **Open for coaches:** cursor pagination past 100, with `total` already returned. Acceptance: two pages of 100, no duplicate ids, footer cursor matches the response.
2. **Done.** Audit filters and before/after for role, suspension, report, and membership changes.
3. **Done.** Indexes listed in F9.
4. **Done** for overview/reports/users/audit and the two panels. **Open:** the same section error pattern on support, memberships, and communities, with a retry that does not reload unrelated tabs.
5. **Open.** Audit ticket replies and status changes without storing a duplicate of the message body if the ticket already has it. Acceptance: an audit row names actor, ticket id, and status transition; the body stays on the ticket.

### P2 — navigation and the operations layout

1. **Done.** Overview matches the requested header, four cards, and priority queue, in the existing theme. Stock and 24-hour activity stay.
2. **Done.** Report SUSPEND is available when the report has an account and the note is at least 10 characters.
3. **Open.** Move reports, users, support, memberships, and audit out of `index.tsx` without changing test ids. Acceptance: `admin.spec.ts` and `management.spec.ts` pass unchanged, and `index.tsx` only composes the modules.

### P3 — aging and data quality

1. **Done** for the oldest open report and the unassigned count on the overview.
2. **Open.** Show the oldest unassigned ticket age on the priority row (the API field `oldest_unassigned_ticket_at` is already returned).
3. **Open.** Coach directory: when `total > loaded` and `next_cursor` is null, the footer already warns. Replacing the cap is the real fix (P1).

### P4 — hardening

1. **Done for the lost-claim case.** `test_lost_report_claim_does_not_suspend` forces `modified_count == 0` and asserts the account is not suspended and no `user.suspended` audit row is written. A live two-connection race is not in the suite. If the side effect throws after the claim, the report stays resolved so a second reviewer cannot dismiss over a suspension that already landed. If it throws before its own write, that report cannot be retried from the queue.
2. **Open.** Keyboard path that tabs from the header through the priority queue and activates a card without a pointer. Acceptance: a Playwright keyboard test on the desktop project.
3. **Open.** Staff-note writes are audited, or an explicit comment stays in the permission matrix that notes are intentionally outside `audit_log`.

## What this branch does not change

- No new staff permission strings.
- No SQL migration. New indexes are created in the existing Mongo lifespan hook.
- No weakening of route checks to make a tab easier to open.
- No claim that the console is legally compliant. The 24 hour queue highlight is a product target, not a legal SLA. Coach paging is described in Phase 2.

## Phase 2

Date: 2026-10-09. Continues on `cursor/admin-console-audit-9d72` after `c46d88d`.

### What changed

- **Coaches.** `GET /admin/coaches` pages with the same opaque cursor as the other queues. Pending and rejected walk `created_at` ascending. Approved and suspended walk `created_at` descending. The cursor is taken from the sorted document, not the joined row. The response stays `{coaches, total, next_cursor}`. A bare array is still accepted by `staffPage()` so the management fixture keeps working. Index: `coach_applications (status, created_at, id)`.
- **Ticket audit.** Status and assignee changes were already `ticket.status_changed` and `ticket.assignee_changed`. Staff replies now write `ticket.replied` with actor, ticket id, message id, from/to status (the status at send time), and `has_attachment`. The reply body is not copied. A ticket update matches `{id, status, assignee_id}`. A lost race is 409 and writes no audit row.
- **Report side effects.** The claim still sets `status=resolved` before removal, suspension, or the notice. `resolution_status` starts as `partial` with `side_effect_error=pending`. The `report.{resolution}` audit row is written before the side effect. A thrown side effect stores a stable code (`content_removal_failed`, `suspension_failed`, `notice_failed`, `side_effect_failed`), not the exception text. `POST /admin/reports/{id}/retry-side-effect` (`reports.resolve`) claims `resolution_status` from `partial` to `retrying` before the same idempotent path, so a second caller gets 409 while the first retry is in progress. The row is then set back to `partial` or `complete`. A second retry after `complete` is 409. The audit action is `report.side_effect_retried` with from `partial` to `complete` or `partial`. Removal no-ops when the target is gone, suspension is skipped when `suspended_at` is set, and the notice is skipped when a `moderation_action` notification already exists for that report.
- **Staff notes.** `user.note_added` was already written without the note text. A test now locks that.
- **Accounting.** A read that stops at the row cap, or a mix of readable and unreadable rows, is `state: incomplete` with `reason: row_cap` or `malformed_rows` and the totals that were actually read. A collection that fails to load stays `unavailable`. Rows that store no amounts stay `recorded` with `amounts_stored: false`. Currencies are still never added. The panel groups Collected, Deductions, and Liabilities (owed to coaches, commissions pending, referral rewards pending). Paid commissions and paid referral rewards sit under Recorded payouts. Each recorded bucket says Recorded. Incomplete buckets say the totals are only the rows that were read.
- **Queue age.** `ADMIN_QUEUE_TARGET_HOURS` is 24 in `frontend/src/components/admin/queue-age.ts`. It is a product target for highlighting, not a legal SLA. The unassigned priority row shows `oldest_unassigned_ticket_at`. The reports tab shows `oldest_open_report_at`. Overdue rows use the error color, not chartreuse.
- **Console structure.** `frontend/staff/index.tsx` is the shell: header, tab list, and one mounted hook. Reports, users, support, audit, memberships, communities, coaches, and staff roles live under `frontend/src/components/admin/`. Shared pieces: `QueueList`, `FilterBar`, `DetailPanel`, `ConfirmAction`, `SectionState`, `PageFooter`. Test ids are unchanged. Existing one-click resolve, suspend, and approve actions stay one click. The confirm dialog is the retry for a partial report. Duplicate clicks are ignored by a synchronous busy lock, and the buttons disable while that lock is held.
- **Filters.** Web address-bar keys: `tab`, `reportStatus`, `reportType`, `coach`, `join`, `ticketStatus`, `unassigned`, `userStatus`, `q`, `tq`, `actor`, `action`, `target`, `from`, `to`. `history.replaceState` updates the current entry. User search, ticket search, and audit fields debounce at 300ms. In-flight report, user, and audit reads abort, and a generation counter drops a late response. Mutations refresh overview counts and the audit page. Each panel has a last-updated line and its own retry.
- **Keyboard and layout.** Queue controls use button roles and accessible names. Opening a ticket moves focus to Back. Closing it returns focus to that ticket. The retry confirm control takes focus when it opens. Web focus uses a text-colored ring. Below 720px the header wraps. Cards and inputs stay within the viewport.
- **Lint.** `frontend/app/community/[id]/manage.tsx` types the insight chips as `readonly (readonly [keyof CommunityInsights, string])[]`.

### API changes

| Method | Path | Change |
| --- | --- | --- |
| GET | `/admin/coaches` | Query `cursor`. Same `{coaches, total, next_cursor}` envelope, now paged past 100. |
| POST | `/admin/reports/{id}/retry-side-effect` | New. `reports.resolve`. Claims `partial` → `retrying`, then `partial` or `complete`. 409 if it is not partial, including a retry already in progress. |
| PATCH | `/admin/reports/{id}` | Response may include `resolution_status` (`partial` or `complete`) and `side_effect_error`. |
| PATCH | `/admin/tickets/{id}` | 409 when status or assignee changed since the read. Audit only after the update matches. |
| POST | `/admin/tickets/{id}/messages` | Also writes `ticket.replied`. Response body is unchanged. |
| GET | `/admin/accounting/summary` | Sections may be `state: incomplete` with `reason` `row_cap` or `malformed_rows`. |

### Remaining risks

- Free-text `q`, `tq`, and `actor` are written into the address bar, so an email can sit in browser history on a shared machine.
- `public.reports` in `supabase/migrations/003_community_social.sql` has no `resolution_status` column. Reports are stored in Mongo. The SQL file is a mirror contract and is not written by this app.
- A live two-connection race is not in the suite. The lost-claim and lost-ticket tests force `modified_count == 0`.
- Confirm-before-act covers the side-effect retry. Resolve, suspend, approve, and membership review stay one click so the existing specs keep their single press. The busy lock is what blocks a double submit.
- Coach review is still an unconditional update on the application. The directory cursor does not make that review conditional.
- `analytics.viewed` is still written on each analytics view.
- A failed request is still not an audit row. The action name is the recorded outcome.
- The 24 hour highlight is a product target, not a contractual SLA.
- Accounting totals marked incomplete are the rows read before the cap or the rows that parsed. They are not a complete-period figure. A capped subscription read marks each plan bucket incomplete as well as the parent object.
- A process kill during a side-effect retry can leave `resolution_status=retrying`. The retry route will not take that row, because it only claims `partial`.
- Subscription plan amounts stay next to the liability group as “last amount on file”. They are not added into owed-to-coaches.
