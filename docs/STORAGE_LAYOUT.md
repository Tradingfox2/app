# IronFlow media storage layout

## Buckets / roots

| Audience | Store | Object key prefix | Local fallback |
|---|---|---|---|
| End-user | `MEDIA_S3_BUCKET` or local | `users/{user_id}/{media_id}.{ext}` | `backend/media/users/...` |
| Staff/admin | same bucket / root | `admin/{staff_id}/{asset_id}.{ext}` | `backend/media/admin/...` |
| Lab PDFs (private) | Emergent objstore (`storage.py`) | `ironflow/uploads/{user_id}/...` | n/a |

## Metadata

- **User:** existing `public.media` / Mongo `media` (image|video). Ticket attachments reference `media.id` via `support_ticket_messages.media_id` — no parallel user_media table.
- **Admin:** `public.admin_media` / Mongo `admin_media`.

## Access

| Who | User media | Admin media |
|---|---|---|
| Owner user | create/read own | — |
| Staff (`staff_role`) | read when attached to tickets / moderation | create/read |
| Direct client (RLS) | deny-by-default | deny-by-default |

API uses the service role and enforces rules in FastAPI.

## Retention

Soft-delete on `admin_media.deleted_at` first; GC of blobs is a later job. Do not hard-delete blobs still referenced by open tickets.

## Public URL contract

`media_storage.store(key, data, content_type)` for both prefixes. Local mode: `/api/media/files/{key}`.
