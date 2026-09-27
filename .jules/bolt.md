# Bolt's Journal — Critical Performance Learnings

> Only CRITICAL, codebase-specific learnings. Not a work log.

## 2026-09-01 - Tooling reality check (IronFlow, not a generic web app)
**Learning:** The base Bolt prompt assumed a `pnpm`-based web app with `pnpm lint`/`pnpm test`. This repo is different: an Expo/React Native frontend (`frontend/`, lint via `expo lint`, **no test runner at all**) plus a FastAPI + async-Mongo (`motor`) backend (`backend/`, tests via `pytest`, lint via `flake8`/`black`). Running `pnpm test` here fails immediately and wastes a cycle.
**Action:** Use the per-package commands in `.jules/bolt-prompt.md` § VERIFY. Never assume a monorepo-root `pnpm`. Backend perf work must have `pytest` green; frontend changes are validated by `expo lint` + type-check + manual reasoning (no unit tests exist to lean on).

## 2026-09-01 - Do NOT touch pytest.ini addopts
**Learning:** `backend/pytest.ini` pins `-n 2 --dist loadscope` and carries an explicit "AGENT: do NOT modify addopts" note. Generated suites share one preview backend and assume `loadscope` sequencing; changing it causes cross-test races or collection errors.
**Action:** Run `pytest` as configured. If a serial run is ever needed, use `-n 0` (not `-p no:xdist`). Never edit `addopts`.
