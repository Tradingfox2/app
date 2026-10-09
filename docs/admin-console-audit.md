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

## Phase 3 + final review

Date: 2026-10-09. Branch `cursor/admin-console-phase3-89ef` from `da894b0`.

### Executive summary

Phase 3 closes the remaining staff-console gaps from the Phase 2 risk list. Coach approval and rejection now claim the pending row, so one reviewer wins and the loser gets 409 with no audit row. Destructive staff actions ask in a focus-trapped dialog before they run, and the reason field enforces the existing length rules. A report side-effect retry holds a five-minute lease; a killed worker can be reclaimed after that, including from the resolved queue. Free-text search stays in `sessionStorage`. Failed and denied mutations are audit rows with a stable reason code, and the audit API and console filter on outcome. Analytics panel opens write at most one `analytics.viewed` row per actor per 15 minutes. `npx tsc --noEmit` is clean. `public.reports` is an unused SQL mirror, so this phase adds no migration. An independent review then found three cross-writer holes (stuck `retrying` rows hidden in the console, community report and membership updates that ignored a staff claim, and a late coach reapply that could replace an approval). Those are fixed on this branch.

### Architecture map

Staff identity is `users.staff_role`. Product `users.role` does not grant console permissions. The sets live in `backend/staff_roles.py`: support ⊂ moderator ⊂ admin. `staff.require` loads the account on each request through `current_user`. HTTP writes that lack the permission append `staff.permission_denied` via `backend/request_context.py`. Reads that 403 do not.

Mutations that can race use a conditional `update_one` on the status that was read. `modified_count != 1` is 409 and writes no audit row and no side effect. A later request that reads an already-closed row writes `outcome=failed` with a stable `reason_code`.

Audit rows live in Mongo `audit_log`. `outcome` is `success`, `failed`, or `denied`. Failed and denied rows keep `reason` empty and replace `metadata` with `{reason_code}` only. Success rows keep the caller’s reason and the from/to metadata. `GET /admin/audit-log?outcome=success` also returns rows written before `outcome` existed.

Reports stay in Mongo. A resolve claims `open` → `resolved` with `resolution_status=partial`. The retry route claims `partial`, or `retrying` when `side_effect_lease_at` is missing or older than `REPORT_SIDE_EFFECT_LEASE` (5 minutes), sets `retrying` plus a new lease, then marks `partial` or `complete` and clears the lease. List and detail payloads include `retry_claimable`.

The console is `frontend/staff/index.tsx` plus `frontend/src/components/admin/`. Chartreuse (`colors.brand`) stays on the selected tab and primary fills. Filter chips and dialogs use the existing surface and text styles. `ConfirmAction` is a web dialog (`role=dialog`, `aria-modal`), traps Tab, closes on Escape, and restores the opener. Confirm is disabled until `minReason` is met.

### Confirmed defects

These were still true at the start of the independent review and are fixed on this branch.

1. A killed retry left `resolution_status=retrying`. The API could reclaim it after five minutes, but the console only rendered Retry for `partial`, and the client type omitted `retrying`. The resolved queue now shows Retry when `retry_claimable` is true, and “A retry is in progress.” while the lease is fresh.
2. `review_community_report` removed content and then updated the report by id. A community moderator could overwrite a staff resolution and still write `community.report_*`. The update now matches `status: open` before removal. A loss is 409 with no removal and no audit. If removal throws, the row is put back to `open` and the exception propagates.
3. Community `review_membership` updated the member by id. A manager who had read `pending` could overwrite a staff decision. The update now matches the status that was read. A loss is 409 with no notification and no audit.
4. `apply_to_coach` replaced the application by `user_id` after reading `rejected`. An approval that landed in between was written back to `pending` while `role` stayed `coach`. The replace now matches the status that was read. If that row is already `pending` or `approved`, the current row is returned and `coach_status` is left alone.

### Rejected hypotheses

- Support adding a staff note with `users.read`. There is no separate notes permission. The success audit is `user.note_added` and does not store the note. A missing account is `failed` / `not_found` and does not store the draft.
- Reinstate using `users.suspend`. There is no separate reinstate permission. Staff targets still go through `_staff_guard`, so a moderator cannot reinstate an admin.
- Membership and community lists using `users.read` while the decision uses `content.moderate`. The list is a read. The decision is the mutation.
- Report `content_snapshot` in the staff queue. It is the excerpt the reporter filed. Account detail does not join biomarkers, lab rows, or live direct-message documents. Ticket bodies stay on the ticket. `ticket.replied` stores `message_id`, from/to status, and `has_attachment`.
- A partial side effect recorded as `outcome=success`. The decision completed. The report stays `partial` with a stable `side_effect_error`.
- Approve, dismiss, and warning staying one click. The confirm list is resolve-with-remove, resolve-with-suspend, suspend, reinstate, role change, coach reject, and membership approve/reject. Coach approve stays one click. A suspended coach is changed from the account suspend dialog.
- `public.reports` needing a `resolution_status` migration. The running app reads and writes Mongo `db.reports` only. Nothing in the backend reads or writes that SQL table. No migration was added. A future SQL port would need `resolution_status`, `side_effect_error`, and `side_effect_lease_at`.
- `accounting.viewed` should share the analytics dedupe window. Each open carries a different period in metadata, and `test_accounting` expects two rows for two periods. The 15-minute window applies to `analytics.viewed` (`target_type=analytics`, `target_id=product_events`).

### Roadmap status

1. Coach application review is a conditional claim on `status: pending`. The loser is 409 with no audit row. A sequential review of a row that is already decided is `failed` / `not_pending` and does not store the note. Covered by `test_coach_review_is_a_single_winner`.
2. Confirm-before-act is in place for the destructive actions listed above. The dialog traps focus and requires a reason where the policy already did (suspend and report-suspend 10, reinstate, role, and membership 5, content removal and coach reject confirm with the page note). Playwright clicks the confirm control. It does not skip the action.
3. Stuck `retrying` reports carry `side_effect_lease_at`. The retry route reclaims a missing lease or a lease older than 5 minutes. A fresh lease is 409 with no audit. Covered by `test_stale_retry_lease_can_be_reclaimed`. The console uses `retry_claimable`.
4. `q`, `tq`, and `actor` are stripped from the address bar and stored in `sessionStorage` key `ironflow.staff.search`. Structured filters, including `outcome`, stay in the query string. Covered by the Playwright test “free-text search stays out of the address bar”.
5. Failed and denied staff mutations write `outcome` and `reason_code`. The audit API accepts `outcome`. The console chips are All outcomes, Succeeded, Failed, and Denied. Lost concurrent claims still write no row.
6. `analytics.viewed` is deduped for `ANALYTICS_VIEW_WINDOW` (15 minutes) per actor, action, and panel. Covered by `test_analytics_view_is_deduped`.
7. The three `userSelect` `TextInput` errors are fixed by copying border and transition fields into a `TextStyle` (`fieldTextStyle`). Global React Native types are unchanged. `npx tsc --noEmit` exits 0.
8. `public.reports` is documented as unused. No SQL migration.
9. Independent review completed. The four defects above are fixed. Authorization on the admin routes matches `staff_roles.py`: overview, users, notes, report list, membership list, and community list are `users.read`; report resolve and retry are `reports.resolve`; suspend and reinstate are `users.suspend`; staff role is `staff.manage`; membership decision is `content.moderate`; tickets split `tickets.read` / `tickets.write`; audit is `audit.read`; accounting is `accounting.read`; analytics is `analytics.read`; coach directory and review are `coaches.review`.
10. Test commands and results are in the tests section.

### What changed

- `staff.audit` accepts `outcome` and `reason_code`. Non-success rows drop the caller note and any extra metadata.
- `staff.require` records `staff.permission_denied` on POST, PUT, PATCH, and DELETE when the request context is set.
- `staff.audit_view` skips a second success row for the same actor, action, and target inside 15 minutes.
- Report retry sets and clears `side_effect_lease_at`. `_mark_resolution` unsets the lease when the attempt finishes.
- Coach review, community report review, community membership review, and coach reapply match the status they read.
- A missing account on suspend, reinstate, role change, and staff note is `failed` / `not_found`.
- The console confirm dialog, session search, outcome filter, and `retry_claimable` display are in the admin components. Playwright specs click confirm and assert that search text stays out of the URL.

### Files

- `backend/request_context.py` (new), `backend/staff.py`, `backend/server.py`
- `backend/routers/admin.py`, `backend/routers/analytics.py`, `backend/routers/community.py`, `backend/routers/tickets.py`
- `backend/tests/test_admin_console.py`, `backend/tests/test_support_tickets.py`, `backend/tests/test_community_complete.py`
- `frontend/src/press-feedback.ts`, `frontend/app/(tabs)/workouts.tsx`, `frontend/app/workout/[id].tsx`
- `frontend/src/api.ts`, `frontend/src/components/admin/*` (confirm, query, hook, reports, users, coaches, memberships, audit)
- `frontend/e2e/admin.spec.ts`, `frontend/e2e/management.spec.ts`
- `docs/admin-console-audit.md`

### API, schema, and migrations

| Method | Path | Change |
| --- | --- | --- |
| GET | `/admin/audit-log` | Query `outcome` is `success`, `failed`, or `denied`. `success` includes rows with no `outcome` field. |
| GET | `/admin/reports` | Each row includes `retry_claimable`. |
| PATCH | `/admin/reports/{id}` | Response includes `retry_claimable`. `resolution_status` may be `retrying` while a retry owns the row. |
| POST | `/admin/reports/{id}/retry-side-effect` | Also claims `retrying` when the lease is missing or older than 5 minutes. A fresh lease is 409 with no audit. A finished row is 409 with `failed` / `not_retryable`. |
| PATCH | `/admin/coach-applications/{id}` | Updates only while `status` is `pending`. |
| PATCH | `/communities/{id}/reports/{report_id}` | Updates only while `status` is `open`, and removes content only after that claim. |
| PATCH | `/communities/{id}/members/{member_id}` | Updates only while `status` is the status that was read. |
| POST | `/coach/applications` | Replaces a rejected application only while it is still rejected. |

Audit documents gained `outcome` and `reason_code`. Report documents may carry `side_effect_lease_at` during a retry. Mongo indexes added in the existing lifespan hook: `audit_log (outcome, created_at)` and `audit_log (actor_id, action, target_id, created_at)`. No SQL migration.

Stable reason codes used by the new failed and denied rows: `permission_denied`, `not_found`, `not_pending`, `already_resolved`, `reason_too_short`, `no_account`, `not_removable`, `staff_target`, `self_target`, `owner_locked`, `paid_plan`, `not_retryable`, `assignee_not_staff`, `no_changes`, `status_required`, `media_not_owned`, `reply_rejected`, `unspecified`.

### Tests

Backend, serial, after Mongo was restarted on a fresh dbpath because the previous mongod aborted with “Too many open files”:

`/tmp/ironflow-venv/bin/python -m pytest -q --tb=line -n 0 --continue-on-collection-errors`

**360 passed, 5 warnings, 2 collection errors, 22.29s.** Exit code 1 because of the collection errors.

Pre-existing collection errors, unchanged by this branch: `tests/backend_test.py` and `tests/test_community_integration.py` raise `KeyError: EXPO_PUBLIC_BACKEND_URL` at import. They are live HTTP suites. This environment has no `frontend/.env` and no `EXPO_PUBLIC_BACKEND_URL`. With the default `-n 2` they also fail collection; `--continue-on-collection-errors` is what lets the unit suite finish in one process.

`npx tsc --noEmit` in `frontend/`: exit 0.

`yarn lint` (`expo lint`): exit 0.

Playwright, full `e2e/` on desktop and mobile (374 tests, 1 worker, both Expo web servers):

**359 passed, 13 failed, 2 skipped, 14.5m.** Exit code 1.

One failure was this branch: desktop “free-text search stays out of the address bar” expected `aria-selected="true"` on the Failed outcome chip. React Native Web does not copy `accessibilityState.selected` onto `aria-selected`. The chip now uses `selectedControl`, the same helper as the ticket filters. The mobile copy of that test passed after the helper was saved (Metro reloaded). Desktop is re-run after the full suite; the result of that re-run is recorded at the end of this section once it finishes.

The other 12 failures are outside the staff-console diff. Both projects failed the same way, and the screens are not in this change:

- `community-slice2` “pending member of a private club”: `getByText('Iron Club')` matches two nodes (strict mode).
- `community-slice2` “invite failure”: `invite-error` text is `"Invite limit reached"` because the icon glyph is inside the text node. Expected `"Invite limit reached"`.
- `community.spec` “FIND A CLUB” and “become a coach”: the same icon-glyph prefix on `community-primary-cta`.
- `wave-a` logger: after `goBack()` from `/muscles` the muscles screen is still showing, so `planned-bench-press` is absent. The workout edit on this branch only wraps `TextInput` styles.
- `activity-day` mobile only: the today card extends past the fold. Desktop passed.
- `community-complete` mobile only: `remove-reported-rep-1` stays “not stable” until the 45s timeout. Desktop passed.

### Security and privacy review

The permission matrix is unchanged. Write denials on staff routes are audited as `denied` / `permission_denied` with the permission name as `target_id`. The caller’s body is not stored. Lost claims stay silent so the winner’s row is the only success record. Sequential policy failures (already resolved, not pending, staff target, self target, short reason, missing assignee) are audited and do not copy the note, the ticket body, or the exception string. Side-effect failures stay the existing codes (`content_removal_failed`, `suspension_failed`, `notice_failed`, `side_effect_failed`).

Account responses still use `ACCOUNT_FIELDS` and omit biomarkers and labs. Direct-message bodies are not loaded for account detail. A reported message can still appear as `content_snapshot` because the reporter filed that excerpt. Search terms that can be emails are kept in `sessionStorage` for the tab and are removed from the query string if someone pastes them into the URL.

### Known limits

- Two analytics opens in the same instant can both pass the find-then-insert dedupe and write two rows. The window is not a unique lock.
- Request bodies rejected by Pydantic before the handler (for example a suspend reason shorter than the schema minimum) do not get an audit row. The report-suspend short note is checked in the handler and is audited as `reason_too_short`.
- A suspended account’s 403 from `current_user`, before staff authorization, is not a staff-decision audit row.
- `accounting.viewed` is still one row per open.
- GET 403 is not audited.
- A live two-socket race is not in the suite. Lost-claim tests force `modified_count == 0` or replace the row inside the intercepted write.
- The 24 hour queue highlight remains a product target, not a legal SLA.
- Subscription plan amounts remain “last amount on file”. They are not added into owed-to-coaches.
- `public.reports` can drift from Mongo. The app does not read it.

### Next phase

Keyboard coverage for the whole console is still the open P4 item: a desktop Playwright path that tabs from the header through the priority queue and activates a card. The retry dialog and the new confirm dialogs already trap Tab. A unique index, or an insert that treats duplicate-key as success, would close the analytics double-write window. If SQL ever becomes the report store, add `resolution_status`, `side_effect_error`, and `side_effect_lease_at` in a new migration rather than editing `003_community_social.sql`.

### Playwright re-run

After the outcome chip used `selectedControl`, the same spec was run again:

`npx playwright test e2e/admin.spec.ts -g "free-text search stays out"`

**2 passed (desktop and mobile), 12.2s.** Exit code 0.

With that fix, the full-suite picture is 360 passed, 12 failed, 2 skipped. The 12 failures are the pre-existing cases listed above. The full 374-test process was not started a second time.
