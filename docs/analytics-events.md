# IronFlow analytics events (v1)

Product analytics is a thin loop: an authenticated client (or, later, the
API itself) writes one row per event, and the staff console reads counts
from those rows. There is no warehouse, no sampled chart, and no client-side
metric.

**Live source of truth is the MongoDB collection `analytics_events`: FastAPI/Motor writes it and the admin rollup reads it.** There is no Supabase migration for this collection and no runtime write to Postgres. SQLAlchemy and Alembic are not used.

Live session start, join, and end are written only there, from the server (`analytics.record`, source `server`). `insight_events` is not written anymore. `insights.emit` ignores the call so a leftover caller cannot open a second log. Old `insight_events` rows are history; nothing in the product reads them.

These screens stay on their own documents, not on `analytics_events`:

- Community Insights (`GET /communities/{id}/insights`) counts memberships and messages.
- The partner dashboard counts active members, pending requests, and owned communities.
- The home training week card (tonnage, sets, streak) counts workouts. It is not `workout_completed`.

## Envelope

Every stored row has these fields:

| Field | Required | Meaning |
|---|---|---|
| `event_id` | yes | UUID. The client may send one for a retry; a repeat is stored once. |
| `name` | yes | One of the names below. |
| `ts` | yes | UTC time the API accepted the event. Device clocks are ignored. |
| `actor_id` | yes | Authenticated user id. The body cannot set this. |
| `role` | no | Product role at ingest time: `athlete`, `coach`, or `admin`. |
| `session_id` | no | Client session id, 8–64 letters, digits, `_` or `-`. |
| `source` | yes | `client` for `POST /api/events`, `server` for `analytics.record` inside the API. |
| `props` | yes | Allow-listed scalars only. Unknown keys are dropped. |

`role` on the row is the product role (`users.role`), not `staff_role`.
Staff power is what gates the read API, not what is written on each event.

Properties are short ids and flags. Post text, emails, message bodies, and
health data are not accepted.

## Events

| Name | Properties | Who emits | Wired in this change |
|---|---|---|---|
| `screen_view` | `screen` (route name, no query string) | Client, on navigation. Owner: screenwright. | Taxonomy only |
| `ticket_created` | `ticket_id` | Client, after `POST /api/tickets` returns an id. Owner: opsdesk. | **Yes.** `frontend/src/components/support/ticket-form.tsx` calls `track("ticket_created", …)`. The opening note is not also `ticket_replied`. |
| `ticket_replied` | `ticket_id` | Client, after a member or staff reply succeeds. Owner: opsdesk. | **Yes.** Member replies in `ticket-detail.tsx` and staff replies in `frontend/staff/index.tsx`. |
| `post_created` | `post_id`, `has_media`, `has_poll`, `community_id` (omit when the post is public) | Client, after `POST /api/posts` succeeds. | **Yes.** Feed composer in `frontend/src/components/social/feed.tsx`, and workout share in `frontend/app/workout/[id].tsx`, each call `track("post_created", …)` once. |
| `post_shared` | `post_id`, `channel` (`system_share`, `copy`, `x`, `facebook`, `whatsapp`, `linkedin`) | Client, after a share succeeds. Owner: socialgraph. | **Yes.** `frontend/src/share.ts` calls `track("post_shared", { post_id, channel })` when the system sheet completes (`system_share`), a copy succeeds (`copy`), or a network composer opens. Dismiss, cancel, and failure do not emit. |
| `live_session_started` | `session_id`, `channel_id` | Server, inside `start_live_session`, source `server`. Owner: community. | **Yes.** `analytics.record` from `_emit_live`. Not written to `insight_events`. |
| `live_session_joined` | `session_id` | Server, the first time a member joins a live room. Owner: community. | **Yes.** One row per member per room. A second join does not emit. |
| `live_session_ended` | `session_id`, `channel_id` | Server, inside `end_live_session`, source `server`. Owner: community. | **Yes.** Cancelling a room that never went live does not emit. |
| `story_created` | `story_id`, `has_media`, `highlight` | Client, after `POST /api/stories` succeeds. Owner: personal space. | **Yes.** The story form in `frontend/app/story-new.tsx` calls `track("story_created", …)`. |
| `workout_completed` | `workout_id` | Server, inside `POST /workouts/{id}/finish`, source `server`, only when `ended_at` was empty. | **Yes.** A second finish does not emit. The client does not also call `track`. |

Emit each occurrence once. The feed composer and the workout share screen
are the client paths for `post_created`. Do not also record `post_created`
on the server for that same publish, or the rollup will double-count.
Server emits (`live_session_*`, `workout_completed`) call
`analytics.record(..., source="server")` and do not also call `track`.

`community_id` and ids are strings up to 80 printable characters. `has_media`
and `has_poll` are booleans.

## Ingest

`POST /api/events` requires a bearer token (`current_user`).

One event:

```json
{
  "name": "post_created",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "props": {"post_id": "…", "has_media": false, "has_poll": false}
}
```

Or a batch of 1–25:

```json
{ "events": [ { "name": "screen_view", "props": { "screen": "community" } } ] }
```

Response: `{ "accepted": 1, "duplicates": 0 }`.

The handler copies `actor_id` and `role` from the token's user and forces
`source` to `client`. `actor_id`, `role`, `source`, and `ts` in the body are
rejected (`extra` is forbidden). Unknown event names are `422`. Rate limit:
60 requests per minute per user (`analytics` in `backend/ratelimit.py`).

Indexes, created at API startup:

- unique `event_id`
- `analytics_events_name_ts` on `(name, ts desc)`

## Read

`GET /api/admin/analytics` requires staff permission `analytics.read`.
Support, moderator, and admin staff roles have it. A product role of
`admin` or an approved coach, without `staff_role`, does not.

```json
{
  "generated_at": "2026-09-27T14:00:00+00:00",
  "windows": {
    "24h": {"screen_view": 0, "post_created": 3},
    "7d": {"screen_view": 0, "post_created": 3}
  }
}
```

Every taxonomy name is present. The number is the count of stored rows in
that window. The last 24 hours are included in the last 7 days. Rows older
than 7 days are not counted. The staff console tab **ANALYTICS**
(`frontend/src/components/admin/analytics-panel.tsx`, mounted from
`frontend/staff/index.tsx`) renders this payload and nothing else.

Coaches who are not staff keep using `GET /api/partner/dashboard` for their
own communities. That screen is not this rollup.

## Client helper

`frontend/src/analytics.ts` exports `track(name, props)`. It posts one event
with a session id created for the JS runtime (`crypto.randomUUID` when the
platform provides it). Failures are ignored so analytics cannot fail the
user action that triggered them.

## Prove path

Publishing from the community feed composer:

1. `api.publish` creates the post (`POST /api/posts`).
2. On success, `track("post_created", { post_id, has_media, has_poll, community_id? })` runs.
3. A staff member opens **Staff console → Analytics** and the `post_created` counts come from `GET /api/admin/analytics`.

Workout share (`frontend/app/workout/[id].tsx`) creates a post and then
calls the same `track("post_created", { post_id, has_media: false, has_poll: false })`
once. Finish itself is the server event `workout_completed`, not a second
`post_created`.

## Manual check

With the API on port 8001, a normal user token in `$TOKEN`, and a staff
token in `$STAFF_TOKEN`:

```bash
curl -sS -X POST "$EXPO_PUBLIC_BACKEND_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"events":[
    {"name":"post_created","props":{"post_id":"manual-1","has_media":false,"has_poll":false}},
    {"name":"post_created","props":{"post_id":"manual-2","has_media":true,"has_poll":false}},
    {"name":"screen_view","props":{"screen":"community"}}
  ]}'

curl -sS "$EXPO_PUBLIC_BACKEND_URL/api/admin/analytics" \
  -H "Authorization: Bearer $STAFF_TOKEN"
```

The first call returns `"accepted": 3`. Refresh the staff Analytics tab.
`post_created` for 24h and for 7d both include those two posts, and
`screen_view` includes the one view. Posting the same `event_id` again
increases `duplicates` and does not increase the counts.

Automated proof:

```bash
cd backend && python -m pytest tests/test_analytics.py -q
```

## Handoffs

- **schemaforge** — live store is Mongo `analytics_events` only. No SQL migration in this change. Other product tables keep their existing Supabase mirrors; this event log does not, because nothing applies or queries a Postgres copy.
- **apismith** — ingest style is `POST /api/events` (single or `events[]`), actor from the token, idempotent `event_id`.
- **screenwright** — emit `screen_view` from navigation via `track`. Do not put query parameters in `screen`.
- **socialgraph** — `post_created` is live on the feed composer and on workout share. `post_shared` is live in `frontend/src/share.ts` (feed menu, share bar, and post detail).
- **community** — `live_session_started`, `live_session_joined`, and `live_session_ended` are server emits on `analytics_events`. Do not write them to `insight_events`.
- **opsdesk** — the Analytics tab lives on `/admin`. `ticket_created` and `ticket_replied` are client emits. Do not point this tab at `admin/overview` activity counts; those count domain documents, not events.
- **glossary** — metric chips on staff Analytics, community Insights, and the partner dashboard use `MetricGlossary` (`frontend/src/components/metric-glossary.tsx`). The sentences live in `frontend/src/analytics-locales.ts` (`METRIC_GLOSSARY`). Hover, long-press, or a tap shows the sentence. Those Insights and partner numbers are still domain counts; the glossary says so.

## What already existed (and why it was not reused as the event log)

- `GET /api/dashboard` is the athlete home snapshot (training load, streak). It is not a product event stream.
- `GET /api/admin/overview` `activity` counts `workouts`, `posts`, and `messages` documents in the last 24 hours. Those collections stay the source for that card. They are not `analytics_events`.
- `GET /api/communities/{id}/insights` and `GET /api/partner/dashboard` are per-community and per-coach operational counts. They do not read `analytics_events` or `insight_events`.
- `insight_events` used to receive live start/join/end, including the session title. That write is retired. The same lifecycle is `live_session_started`, `live_session_joined`, and `live_session_ended` on `analytics_events`, with ids only.
- There was no `analytics_events` collection, no event taxonomy, and no `track` helper.
- `Math.random` in `frontend/src/offline-queue.ts` builds a local offline id. It is not a metric and was left alone.
