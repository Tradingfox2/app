# Staff console — Precision Performance

Branch `design/ironflow-command-center-2`, based on `origin/main` `a4fcfba`. Not deployed. Not merged.

Increment 1–2 (tokens, Barlow, sidebar, overview, sign-in) is already on `main` as `a4fcfba`. This branch finishes the domain screens, the narrow drawer, and the polish pass.

## 1. Executive summary

The staff web console is an operations tool on the shipped dark ground (`#101418` family). Chartreuse (`#D6E35A`) is limited to the sign-in button, the selected navigation item, the selected filter, and the overview links “Open coaches” and “Open memberships”. Display type is bundled Barlow Condensed. Body type is bundled Barlow. From 1080px the navigation is a grouped sidebar. Below that, the same groups open from a header menu into a drawer, so tabs do not wrap. Queue rows, filters, detail cards, status badges, empty and failed states, and page footers are shared components. Status is an icon plus a label. One 180ms entrance is removed when reduced motion is on. The phone drawer does not animate.

No WebGL, no remote photos, no new npm packages, and no change to `frontend/src/theme.ts` or member screens. Permissions, confirm dialogs, URL filters, claim-then-act, audit outcomes, pagination, and accounting math are unchanged. Currencies are not added together. A missing subscription section stays incomplete, not zero.

## 2. Initial audit

Verified on `a4fcfba` before this increment. The shell and sign-in were already restyled. The domain modules were not.

| ID | Evidence | Impact |
| --- | --- | --- |
| D1 | Reports, support, users, coaches, memberships, and audit each drew their own filter chips. | Selected state and chip type drifted per screen. |
| D2 | Report reasons, ticket status, coach tags, and audit outcomes were color or text alone. | A status could not be read without the hue. |
| D3 | Below 1080px the first shell used a horizontal rail. | Tabs wrapped or sat under the page and intercepted taps. |
| D4 | Accounting and analytics had no shared overflow frame. A later pass forced a 560px minimum and pushed long warnings off a 390px screen. | Phone accounting hid the incomplete-subscription sentence. |
| D5 | A failed overview and a non-staff 403 both rendered the lock sentence. | A staff member with a down API looked locked out, with no retry. |

Rejected: rewriting member screens, adding Three.js, painting chartreuse on badges or the wordmark, and changing accounting totals.

## 3. Chosen art direction

**IronFlow Precision Performance**, staff web only.

- Palette: ground `#101418`, surface `#1A1F24`, raised `#242A31`, line `#343B44`. Accent `#D6E35A` on the sign-in button, the selected tab (border, label, icon), the selected filter (border and label), and the two overview queue links. Sign out stays neutral. Queue-count badges use `#9B1C1C` with a light numeral. Alert copy uses `#FF8A8A`. Icon red `#E23B3B` stays on icons and on the overdue row wash, not on body sentences.
- Type: Barlow Condensed for display, Barlow for UI. Both are SIL Open Font License, files in `frontend/assets/fonts`, loaded only from `frontend/staff/_layout.tsx`. Satoshi is not used. Member web stays on Inter/system.
- Materials: sidebar, drawer, confirm dialog, and sign-in card carry one soft shadow. Queue rows and accounting figures stay flat.
- Layout: sidebar at ≥1080px. Below that, a menu button (`admin-nav-menu`) opens a drawer over the page column, not over the header. Page titles are uppercase. Filter chips wrap. They are not the navigation.
- Motion: documented in `frontend/src/components/admin/staff-motion.ts`. Page content uses `ironflow-rise`, 180ms, ease-out, 6px. `staffEnter` returns no style when `useReducedMotion()` is true, and the injected keyframes flatten under `prefers-reduced-motion`. Pressables keep the existing 140ms ease and already drop travel when reduced motion is on. The drawer toggles `display` and does not fade.
- Imagery and 3D: the sign-in mark is an inline SVG in text gray. No remote image. No WebGL.

The overview bar “Open work, right now” is the current counts of open reports, tickets that need a reply, and pending applications. It is not a trend. If those counts are zero, the line says there is no open work.

## 4. Implemented changes

Shared pieces, used by the domain screens instead of per-screen patches:

- `frontend/src/components/admin/filter-chip.tsx` — selected filter is chartreuse border and label, with `aria-selected`.
- `frontend/src/components/admin/filter-bar.tsx` — the chip row (`toolbar`).
- `frontend/src/components/admin/status-badge.tsx` — icon plus label. Tones are danger, warning, ok, neutral, and info. The words stay `#F2F3F4`.
- `frontend/src/components/admin/queue-row.tsx` — one selectable row. Users, support, communities, and team use it.
- `frontend/src/components/admin/detail-panel.tsx` — selected report, ticket, user, coach, and membership.
- `frontend/src/components/admin/queue-list.tsx`, `section-state.tsx`, `page-footer.tsx` — loading, empty, failed, last updated, and “Showing n of total”.
- `frontend/src/components/admin/data-scroll.tsx` — the frame stays at the parent width so labels wrap. It does not force a 560px minimum.
- `frontend/src/components/admin/confirm-action.tsx` — unchanged behavior. The dialog already traps Tab and closes on Escape.

Wired through those components: reports, support, users, coaches, memberships, communities, team, analytics, accounting, audit.

Shell (`frontend/staff/index.tsx`):

- Narrow widths use the drawer. Choosing a tab closes it and calls the same `selectTab`.
- The drawer scrolls. Closed, it is `display: none`, so it does not intercept clicks.
- A signed-in staff member whose overview request fails sees “The operations summary could not be loaded.”, the error, and Retry. An account with no staff role still sees the lock sentence and sign-out only. The console still does not render without an overview payload.
- `frontend/e2e/staff-nav.ts` opens the menu on narrow widths before `admin-tab-*` is clicked. Desktop still uses the sidebar. `toHaveCount` and `toContainText` still see the drawer nodes while they are hidden.

Accounting still prints one figure per stored currency. `accounting-subscriptions-incomplete` still holds “incomplete, not zero”. A missing community member count says “Member count not recorded” instead of 0.

`frontend/src/theme.ts` is not modified.

## 5. Before / after

Before this increment, domain screens on `a4fcfba` kept the old chip and tag markup inside the new shell. Captures of the shell at that point are under `/opt/cursor/artifacts/staff-design/`.

After, captured from the local staff server with synthetic fixtures (no production data), under `/opt/cursor/artifacts/staff-design-2/`:

| Viewport | Screens |
| --- | --- |
| 1440×900 | `1440x900-signin.png`, `overview`, `reports`, `support`, `users`, `coaches`, `joins`, `communities`, `team`, `analytics`, `accounting`, `audit` |
| 1280×800 | the same twelve names with the `1280x800-` prefix |
| 768×1024 | the same twelve names with the `768x1024-` prefix |
| 390×844 | the same twelve names with the `390x844-` prefix |

File names are `{viewport}-{screen}.png`. Sign-in is the signed-out screen at each size.

Edge cases in the same folder:

| Case | Files |
| --- | --- |
| Empty reports | `edge-empty-reports-1440.png`, `edge-empty-reports-390.png` |
| Overview API failure | `edge-overview-failed-1440.png`, `edge-overview-failed-390.png` |
| Incomplete accounting | `edge-accounting-incomplete-1440.png` |
| Long name | `edge-long-name-1440.png`, `edge-long-name-390.png` |
| Suspend confirm dialog | `edge-suspend-dialog-1440.png` |
| Resolved filter | `edge-filter-resolved-1440.png` |
| Support role (no accounting) | `edge-support-role-1440.png`, `edge-support-role-390.png` |
| Reduced motion | `edge-reduced-motion-1440.png` |
| Loading | `edge-loading-1440.png` |
| Open drawer | `edge-drawer-768.png`, `edge-drawer-390.png` |

Checked on those images: chartreuse sits on the selected nav item, the selected filter, the sign-in button, and the two overview links. The phone drawer leaves the header, the email, and Sign out visible. The incomplete-subscription sentence is on screen at 1440. A failed overview is a retry state, not the lock sentence. The long name wraps. Filter chips wrap on a phone. They do not become a second tab row.

Replay: `IRONFLOW_WEB_TARGET=staff npx expo start --web --port 8083` in `frontend/`, then open `/auth` and `/`.

## 6. Test results

Commands and results on this branch, after the drawer, badge, and overflow fixes:

`cd frontend && yarn lint` (`expo lint` on `src` and `app`): **exit 0**.

`npx eslint staff src/components/admin src/community-locales.ts --max-warnings 0`: **exit 0**.

`npx tsc --noEmit` after regenerating member route types in `frontend/.expo/types/router.d.ts`: **exit 0**. A running staff Expo server rewrites that file to `/` and `/auth` only. `tsc` then reports member href errors that are not in this diff. Regenerate member routes, then typecheck. None of those errors are in `frontend/staff` or `frontend/src/components/admin`.

`cd frontend && npx playwright test --reporter=line`

**371 passed, 1 failed, 2 skipped**, about 12.5 minutes. Exit code 1. Log: `/opt/cursor/artifacts/playwright-full.log`.

The two skips are `e2e/workout-affordance.spec.ts` hover checks, which skip on the mobile project. Desktop ran them.

The failure is `[mobile] e2e/share-loop.spec.ts:64` — `own profile publishes a post that shows on the feed and can be shared`. It timed out in `popupFor` waiting for `window.__ironflowOpened` after “Share on X”. The same test passed on desktop. The page is the member post screen. This diff does not change that screen, the share sheet, or `share-loop.spec.ts`. Treat it as a member-app failure outside this branch.

Every admin and management test in that run completed without a failure, including narrow-width tab clicks through `staff-nav.ts`, accounting currencies, the incomplete-subscription sentence, confirm dialogs, and the non-staff lock.

`cd backend && /tmp/ironflow-venv/bin/python -m pytest -q --tb=line -n 0 --continue-on-collection-errors`

**360 passed, 2 skipped, 5 warnings**, 175.66s. Exit code 0. Log: `/opt/cursor/artifacts/pytest-command-center-2.log`. No Python files are in this diff. The two skips are the live HTTP modules that skip without `EXPO_PUBLIC_BACKEND_URL`.

## 7. Performance and accessibility

Checked: focus ring on `Affordance`; nav items are tabs inside each group tablist; selected tabs and selected filters set `aria-selected`; status badges expose the label and an icon; queue counts are numerals plus a fill; reduced motion skips the entrance and flattens the keyframes; the drawer is not animated; closed drawer is `display: none`; the open drawer’s page column sets `accessibilityElementsHidden`; alert copy uses `#FF8A8A` on `#101418`.

Not measured: Lighthouse, an automated contrast audit, or a screen reader pass. Chartreuse `#D6E35A` on `#242A31` for the selected label is the pair the selected tab already used. The open drawer does not trap Tab. Do not treat this as a completed WCAG audit.

## 8. Dependencies

None added. `package.json` is unchanged.

Already in the app, and why they stay:

- `expo-font` loads the bundled Barlow files. A font CDN would block first paint and is not required.
- `expo-linear-gradient` paints the sign-in and shell wash. It was already a dependency.
- `react-native-svg` draws the sign-in mark. It was already a dependency.
- `@expo/vector-icons` supplies the status and nav icons. It was already a dependency.

Satoshi is commercial and is not bundled. No Three.js, no photo CDN, no component library.

## 9. Remaining work

- **P1.** None in the staff console after the overflow fix. The member `share-loop` mobile timeout is outside this diff. Acceptance for a follow-up on that test: the mobile project records `__ironflowOpened` after the X share control, without changing staff screens.
- **P2.** The open drawer does not trap keyboard focus. Acceptance: Tab cycles inside the drawer until it closes, and the page column is not focused while it is open.
- **P2.** Icon red `#E23B3B` remains on overdue row borders and on destructive action icons. Acceptance: a contrast check of those icons on `#3A1818` and `#101418`, with body sentences staying on `#FF8A8A`.
- **P2.** A member-facing pass only if product asks. Acceptance: `theme.ts` and member screens stay untouched until that pass.

No P0.

## 10. Deployment status

Committed on `design/ironflow-command-center-2` only. Not deployed. Not merged.

## Phase 8 checklist

[Review staff design diff](bc-997ae315-5f30-500b-91bc-4bc62867c381) read this increment and did not edit it. That review found no P0. The P1 was `DataScroll` forcing 560px, which hid long accounting warnings on a phone. The frame now stays at the parent width, and the badges wrap. Also applied from that review: the drawer scroller is bounded, a missing member count is not shown as 0, and overdue and suspended sentences use `#FF8A8A`.

Reviewed on the diff against `a4fcfba`:

- Permissions stay on the backend. The shell hides analytics, accounting, and support only when `can()` is false, which matches the previous shell.
- Confirm, suspend, ticket, membership, coach, audit filter, and pagination tests passed inside the full Playwright run.
- Accounting still renders stored currencies and the incomplete-subscription sentence. No totals were combined.
- The work-mix bar uses the overview counts already on the page. No invented percentage.
- `theme.ts` and member app screens are not in the diff. `community-locales.ts` only adds the failed-overview sentence in French, German, Spanish, and Italian.
- Reduced motion is handled as in section 3.
