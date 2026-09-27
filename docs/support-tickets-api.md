# Support tickets API

Member and staff endpoints for the support queue. Persistence is MongoDB
(`tickets`, `ticket_messages`) through the FastAPI handlers. SQL source of
truth for the same fields is `public.support_tickets` and
`public.support_ticket_messages` in `supabase/migrations/004_support_tickets.sql`.

There is no `priority` field. Clients must not send one; it is ignored and
never stored.

All paths are under `/api`. Every route requires `Authorization: Bearer <jwt>`.
Missing or invalid tokens return **401** with `detail` `"Not authenticated"`
or `"Invalid or expired token"`.

Staff checks use `staff.require`. A signed-in user without the permission
gets **403** `detail` `"Staff permission required"`.

## Permissions

| Staff role | tickets.read | tickets.write |
| --- | --- | --- |
| support | yes | yes |
| moderator | yes (inherited) | yes (inherited) |
| admin | yes (inherited) | yes (inherited) |
| anyone else | no | no |

`tickets.write` covers status changes, assignee changes, and staff replies.
Those status and assignee changes are appended to `audit_log`
(`ticket.status_changed`, `ticket.assignee_changed`). Replies are not audited.

## Fields

`tickets` / `support_tickets`:

| Field | Rules |
| --- | --- |
| id | string uuid |
| user_id | owner |
| subject | 1–120 characters, trimmed |
| category | `billing` \| `account` \| `bug` \| `feature` \| `other` |
| status | `open` \| `pending` \| `closed`, default `open` |
| assignee_id | staff user id, or null |
| created_at, updated_at | UTC timestamps |

`ticket_messages` / `support_ticket_messages`:

| Field | Rules |
| --- | --- |
| id | string uuid |
| ticket_id | parent ticket |
| author_id | writer |
| author_role | `user` or `staff`. Set by the server, never by the client |
| body | 1–5000 characters, trimmed |
| media_id | null, or an id from `POST /api/media` owned by the author |
| created_at | UTC timestamp |

`author_role` on a member route is always `user`. On a staff route it is
always `staff`.

## Member

Owner-scoped. `Depends(current_user)`.

### `POST /api/tickets` → 201

```json
{ "subject": "Invoice missing", "category": "billing", "body": "April invoice never arrived.", "media_id": null }
```

`body` and `media_id` are optional. `media_id` without `body` is **422**.
Unknown media, or media uploaded by someone else, is **422**
`"Unknown media attachment"`. A blank subject after trimming is **422**.

Response is the ticket plus `messages` (empty, or the opening message):

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "subject": "Invoice missing",
  "category": "billing",
  "status": "open",
  "assignee_id": null,
  "created_at": "2026-09-27T14:00:00.000Z",
  "updated_at": "2026-09-27T14:00:00.000Z",
  "messages": [
    {
      "id": "uuid",
      "ticket_id": "uuid",
      "author_id": "uuid",
      "author_role": "user",
      "body": "April invoice never arrived.",
      "media_id": null,
      "created_at": "2026-09-27T14:00:00.000Z"
    }
  ]
}
```

Creating a ticket counts toward the `ticket` rate limit (10 per hour).

### `GET /api/tickets` → 200

The caller's tickets, newest `updated_at` first. No one else's rows.

Query: `status` optional (`open|pending|closed`), `limit` default 50, max 100.

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "subject": "Invoice missing",
    "category": "billing",
    "status": "open",
    "assignee_id": null,
    "created_at": "2026-09-27T14:00:00.000Z",
    "updated_at": "2026-09-27T14:00:00.000Z"
  }
]
```

### `GET /api/tickets/{ticket_id}` → 200

Same shape as create. Messages are oldest first and do not include staff
email addresses.

Someone else's ticket, or an unknown id, is **404** `"Ticket not found"`.

### `POST /api/tickets/{ticket_id}/messages` → 201

```json
{ "body": "Any update?", "media_id": null }
```

Response is the stored message (`author_role` is `user`). The parent
ticket's `updated_at` moves forward. Status is left unchanged.

- Unknown id: **404** `"Ticket not found"`
- Not the owner: **403** `"Not allowed"`
- Owner, but status is `closed`: **403** `"Ticket is closed"`

Message writes count toward `ticket_message` (60 per 5 minutes). Over the
limit: **429** `"You are doing that too often. Try again shortly."`

## Staff

### `GET /api/admin/tickets` → 200

Requires `tickets.read`.

Query: `status` optional, `q` optional (max 80), `limit` default 50, max 100.

`q` is a case-insensitive subject search, an exact ticket id, an exact
`user_id`, or (when it contains `@`) a case-insensitive email match.
The term is escaped, so `.*` does not match every row.

```json
{
  "tickets": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "subject": "Invoice missing",
      "category": "billing",
      "status": "open",
      "assignee_id": null,
      "created_at": "2026-09-27T14:00:00.000Z",
      "updated_at": "2026-09-27T14:00:00.000Z",
      "user": { "id": "uuid", "full_name": "Ada", "email": "ada@example.invalid" },
      "assignee": null
    }
  ],
  "count": 1
}
```

`user` and `assignee` are response-only. They are not stored on the ticket.

### `GET /api/admin/tickets/{ticket_id}` → 200

Requires `tickets.read`. Ticket, owner, assignee, and messages. Each message
includes `author`: `{id, full_name, email}` or null if that account is gone.
Unknown id: **404** `"Ticket not found"`.

### `PATCH /api/admin/tickets/{ticket_id}` → 200

Requires `tickets.write`.

```json
{ "status": "pending", "assignee_id": "staff-user-uuid" }
```

Send either field, or both. `assignee_id: null` clears the assignee.
`{}` is **422** `"No changes"`. `status: null` is **422**
`"Status cannot be cleared"`. A missing user, or a user who is not staff,
is **404** `"Assignee not found"` and nothing is written.

Response matches the staff GET. An unchanged value does not write an audit row.

Audit metadata:

```json
{ "from": "open", "to": "pending" }
```

```json
{ "from": null, "to": "staff-user-uuid" }
```

### `POST /api/admin/tickets/{ticket_id}/messages` → 201

Requires `tickets.write`. Same body as the member reply. `author_role` is
`staff`. Allowed when the ticket is `closed`, so support can leave a closing
note. Unknown ticket: **404**. Same media and rate-limit rules as members.
The attached media must belong to the staff author.

## Smoke checks

Handlers read and write Mongo. `backend/tests/test_support_tickets.py` uses a
throwaway database and the real ASGI app. From `backend/` with Mongo on
`127.0.0.1:27017`:

```bash
python -m pytest tests/test_support_tickets.py -n 0
```

Against a running API (`uvicorn server:app --port 8001` from `backend/`):

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@ironflow.app","password":"demo1234"}' | jq -r .access_token)

curl -s -D- -X POST http://127.0.0.1:8001/api/tickets \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"subject":"Invoice missing","category":"billing","body":"April invoice never arrived."}'

curl -s http://127.0.0.1:8001/api/tickets -H "authorization: Bearer $TOKEN"
```

Staff calls need a user whose `staff_role` is `support`, `moderator`, or `admin`
(`python seed_scripts/grant_staff.py <email> support`). Then:

```bash
curl -s "http://127.0.0.1:8001/api/admin/tickets?status=open&q=invoice" \
  -H "authorization: Bearer $STAFF_TOKEN"
```
