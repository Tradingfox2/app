# IronFlow analytics events (v1)

Product analytics is a thin loop: an authenticated client (or, later, the
API itself) writes one row per event, and the staff console reads counts
from those rows. There is no warehouse, no sampled chart, and no client-side
metric.

The live store is the MongoDB collection `analytics_events`, written by
FastAPI through Motor (`backend/analytics.py`). The same shape is mirrored
in `supabase/migrations/004_analytics_events.sql` so a future copy to
Postgres does not redesign the event. SQLAlchemy and Alembic are not used.

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
| `source` | yes | `client` for `POST /api/events`, `server` for a future API-side emit. |
| `props` | yes | Allow-listed scalars only. Unknown keys are dropped. |

`role` on the row is the product role (`users.role`), not `staff_role`.
Staff power is what gates the read API, not what is written on each event.

Properties are short ids and flags. Post text, emails, message bodies, and
health data are not accepted.

## Events

| Name | Properties | Who emits | Wired in this change |
|---|---|---|---|
| `screen_view` | `screen` (route name, no query string) | Client, on navigation. Owner: screenwright. | Taxonomy only |
| `ticket_created` | `ticket_id` | Client or server when a support ticket is created. Owner: opsdesk. | Taxonomy only. No ticket collection exists yet. |
| `ticket_replied` | `ticket_id` | Client or server when staff or the member replies. Owner: opsdesk. | Taxonomy only. |
| `post_created` | `post_id`, `has_media`, `has_poll`, `community_id` (omit when the post is public) | Client, after `POST /api/posts` succeeds. | **Yes.** Feed composer in `frontend/src/components/social/feed.tsx` calls `track("post_created", …)`. |
| `post_shared` | `post_id`, `channel` (`system_share`, `copy`, `x`, `facebook`, `whatsapp`, `linkedin`) | Client, after a share succeeds. Owner: socialgraph. | **Yes.** `frontend/src/share.ts` calls `track("post_shared", { post_id, channel })` when the system sheet completes (`system_share`), a copy succeeds (`copy`), or a network composer opens. Dismiss, cancel, and failure do not emit. |
| `live_session_started` | `session_id`, `channel_id` | Server, inside `start_live_session`, source `server`. Owner: community. | Taxonomy only |
| `live_session_joined` | `session_id` | Client or server when a member opens the join link or RSVPs into a live session. Owner: community. | Taxonomy only |

Emit each occurrence once. The feed composer is the client path. Do not
also record `post_created` on the server for that same publish, or the
rollup will double-count. A future server emit (live session start) should
call `analytics.record(..., source="server")` and not also call `track`.

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
`frontend/app/admin/index.tsx`) renders this payload and nothing else.

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

Workout share (`frontend/app/workout/[id].tsx`) also creates a post and is
not instrumented. That call site is a socialgraph handoff: use the same
`track("post_created", …)` after a successful publish, still once.

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

- **schemaforge** — collection and `004_analytics_events.sql` are the storage contract. Change columns in both places.
- **apismith** — ingest style is `POST /api/events` (single or `events[]`), actor from the token, idempotent `event_id`.
- **screenwright** — emit `screen_view` from navigation via `track`. Do not put query parameters in `screen`.
- **socialgraph** — `post_created` is live on the feed composer. `post_shared` is live in `frontend/src/share.ts` (feed menu, share bar, and post detail all go through it). Workout share (`frontend/app/workout/[id].tsx`) still needs `track("post_created", …)` after a successful publish.
- **community** — emit `live_session_started` with `analytics.record(..., source="server")` from `start_live_session`, and `live_session_joined` from the join / RSVP path. One emit per occurrence.
- **opsdesk** — the Analytics tab lives on `/admin`. When a ticket model exists, emit `ticket_created` and `ticket_replied`. Do not point this tab at `admin/overview` activity counts; those count domain documents, not events.

## What already existed (and why it was not reused as the event log)

- `GET /api/dashboard` is the athlete home snapshot (training load, streak). It is not a product event stream.
- `GET /api/admin/overview` `activity` counts `workouts`, `posts`, and `messages` documents in the last 24 hours. Those collections stay the source for that card. They are not `analytics_events`.
- `GET /api/communities/{id}/insights` and `GET /api/partner/dashboard` are per-community and per-coach operational counts.
- There was no `analytics_events` collection, no event taxonomy, and no `track` helper.
- `Math.random` in `frontend/src/offline-queue.ts` builds a local offline id. It is not a metric and was left alone.
