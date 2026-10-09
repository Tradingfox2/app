# Staff console — Precision Performance

Branch `design/ironflow-command-center`, based on `origin/main` `4b86bce`. Not deployed. Not merged.

## 1. Executive summary

The staff web console moves from a single wrapping row of tabs on a flat charcoal page to a grouped operations shell. From 1080px the navigation is a left sidebar (Operations, People, Business, Administration). Below that, the same controls stay on one horizontal rail, so a section is still one click. The ground stays in the shipped `#101418` family. Chartreuse (`#D6E35A`) is limited to the primary action, the selected nav item, and key queue links. Display type is bundled Barlow Condensed; body type is bundled Barlow. One 180ms entrance is removed when `prefers-reduced-motion` is set. No WebGL, no remote photos, no new npm packages, and no change to `frontend/src/theme.ts` or member screens.

Phase 3 behavior on `main` is unchanged: permissions, confirm dialogs, URL filters, claim-then-act, audit outcomes, pagination, and API contracts.

## 2. Initial audit

Verified from the tree at `4b86bce` before this change:

| ID | Evidence | Impact |
| --- | --- | --- |
| D1 | `frontend/staff/index.tsx` rendered every section as a wrapping horizontal tab row. | Eleven tabs wrap on a laptop and bury the work. |
| D2 | `frontend/src/components/admin/console-styles.ts` used one border weight, no elevation, and the member `theme.ts` type scale. | The console read as a utility form, not an operations tool. |
| D3 | `design_guidelines.json` specifies Barlow Condensed, Satoshi, brand `#D4FF00`, and `shadow_tier: 0`. `frontend/src/theme.ts` ships Inter/system on the web and brand `#D6E35A`. | The written system and the running system disagree. |
| D4 | `frontend/staff/auth.tsx` was a single dark column with a surface button. | Staff sign-in did not read as the operations product. |

Rejected: rewriting member screens, adding Three.js, and painting chartreuse on badges, role labels, or the wordmark. Those fight Roland’s rule and the daily-use console.

## 3. Chosen art direction

**IronFlow Precision Performance**, staff web only.

- Palette: ground `#101418`, surface `#1A1F24`, raised `#242A31`, line `#343B44`. Accent `#D6E35A` on the sign-in button, the locked-screen sign-out, the selected tab (border, label, icon), and the overview queue links (`Open coaches`, `Open memberships`). Status red, amber, and blue-gray stay, always with a text label.
- Type: Barlow Condensed for display, Barlow for UI. Both are SIL Open Font License, files in `frontend/assets/fonts`, loaded only from `frontend/staff/_layout.tsx`. Satoshi is not licensed here and is not used. Member web stays on Inter/system.
- Materials: sidebar, confirm dialog, and sign-in card carry one soft shadow (`boxShadow` on web). Queues, tables, and accounting figures stay flat.
- Layout: sidebar at ≥1080px; horizontal rail below. Page title repeats the selected section. No command palette.
- Motion: `ironflow-rise`, 180ms, translate 6px. The stylesheet collapses that travel under `prefers-reduced-motion`. Buttons keep the existing focus ring.
- Imagery and 3D: an inline SVG mark on sign-in, drawn in text gray, not chartreuse. No remote image. No WebGL.

The overview bar “Open work, right now” is the current counts of open reports, tickets that need a reply, and pending applications. It is not a trend. If those counts are zero, the line says there is no open work.

## 4. Implemented changes

- `frontend/src/components/admin/staff-theme.ts` — staff tokens. Not imported by member screens.
- `frontend/src/components/admin/staff-fonts.ts`, `staff-motion.ts`
- `frontend/assets/fonts/Barlow-Regular.ttf`, `BarlowCondensed-SemiBold.ttf`, `OFL.txt`
- `frontend/staff/index.tsx` — shell, groups, rail
- `frontend/staff/auth.tsx` — sign-in
- `frontend/staff/_layout.tsx` — font load and page background
- `frontend/src/components/admin/console-styles.ts`, `operations-overview.tsx`, `analytics-panel.tsx`, `accounting-panel.tsx`, `admin-labels.ts`, `page-footer.tsx`
- `frontend/src/staff-console-locales.ts` — group labels
- `frontend/e2e/admin.spec.ts` — support sits in Operations, above analytics in Business
- `design_guidelines.json` — `staff_console` block. Member color values are unchanged.

`frontend/src/theme.ts` is not modified.

## 5. Before / after

Before: wrapping tabs, flat cards, Inter, sign-in as a plain column. That UI is `4b86bce` `frontend/staff/index.tsx`.

After, captured from the local staff server with synthetic fixtures (no production data), viewport screenshots under `/opt/cursor/artifacts/staff-design/`:

| Viewport | Sign-in | Overview | Reports | Audit |
| --- | --- | --- | --- | --- |
| 1440×900 | `desktop-1440-signin.png` | `desktop-1440-overview.png` | `desktop-1440-reports.png` | `desktop-1440-audit.png` |
| 1280×800 | — | `laptop-1280-overview.png` | `laptop-1280-reports.png` | `laptop-1280-audit.png` |
| 768×1024 | — | `tablet-768-overview.png` | `tablet-768-reports.png` | `tablet-768-audit.png` |
| 390×844 | `mobile-390-signin.png` | `mobile-390-overview.png` | `mobile-390-reports.png` | `mobile-390-audit.png` |

Replay: `IRONFLOW_WEB_TARGET=staff npx expo start --web --port 8083` in `frontend/`, then open `/auth` and `/`.

## 6. Test results

After the branch was moved onto `4b86bce` and the Expo servers were restarted from that tree:

`cd frontend && npx playwright test e2e/admin.spec.ts e2e/management.spec.ts --reporter=line`

**84 passed** (desktop and mobile), about 2.5 minutes. Exit code 0.

`npx tsc --noEmit` after regenerating member route types in `.expo/types/router.d.ts`: **exit 0**.

A staff `expo start` rewrites that generated file to staff-only routes (`/` and `/auth`). `tsc` then reports member href errors that are not in this diff. Regenerate member routes before typechecking the whole app. None of those errors are in `frontend/staff` or `frontend/src/components/admin`.

`yarn lint` (`expo lint` on `src` and `app`): **exit 0**. `frontend/staff` was linted with `npx eslint staff` during the work and was clean.

Backend pytest was not re-run. This diff does not change Python.

The full 374-test Playwright suite was not the final run. Member-app failures were fixed on `main` in `4b86bce` by another branch. This run covers admin and management only, which is the surface this change touches, plus the member “no staff console” check.

## 7. Performance and accessibility

Checked: keyboard focus ring already on `Affordance`; nav buttons keep their accessible names and `admin-tab-*` ids; selected state sets `aria-selected` via `selectedControl`; queue counts are numbers plus color; reduced-motion CSS is injected and the entrance style is skipped when `useReducedMotion()` is true; narrow layout keeps every section on the rail without an extra menu click.

Not measured: Lighthouse, a contrast audit tool, or a screen reader pass. Chartreuse on `#242A31` for the selected label is the same pair the console already used for the active tab. Do not treat this as a completed WCAG audit.

## 8. Dependencies

None added. `expo-font`, `expo-linear-gradient`, and `react-native-svg` were already dependencies. Barlow is bundled, so the first screen does not wait on a font CDN.

## 9. Remaining work

- **P1.** Apply a member-facing pass only if product asks. Acceptance: `theme.ts` and member screens stay untouched until that pass, and `design_guidelines.json` member rules are not silently copied onto the staff shell.
- **P2.** Tablet and phone rails scroll sideways. Acceptance: a fade or section jump that does not add a click before `admin-tab-*`.
- **P2.** Sign-in art is an SVG, not a photograph. Acceptance: any photo is bundled, licensed, and still readable with the form.

## 10. Deployment status

Committed only on `design/ironflow-command-center`. Not deployed. Not merged.

## Phase 8 checklist

Reviewed on the diff against `4b86bce`:

- Permissions stay on the backend. The shell only hides analytics, accounting, and support when `can()` is false, which matches the previous shell.
- Confirm, suspend, ticket, membership, coach, audit filter, and pagination tests passed.
- Accounting still renders stored currencies and incomplete subscription amounts. No totals were combined.
- The work-mix bar uses the overview counts already on the page. No invented percentage.
- `theme.ts` and member app files are not in the diff.
- Reduced motion is handled as above.
