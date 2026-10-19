# Auth contract (frontend)

All paths are under `/api`. Errors are FastAPI's shape: `{"detail": "<message>"}` with the HTTP status below.
Validation errors are `422` with FastAPI's `detail` list. Rate limits return `429`.

## Tokens
- `TokenOut`: `{"access_token": "<JWT>", "token_type": "bearer", "user": PublicUser}`
- Send `Authorization: Bearer <access_token>`. HS256 JWT, claims `sub` (user id), `iat`, `exp` (30 days), `tv` (token version).
- There is **no refresh token**. When a request returns `401`, sign the user out.
- Changing or resetting the password bumps `tv`: every older token gets `401 Invalid or expired token`.
  The endpoint returns a fresh `TokenOut`, so store the new token.
- `PublicUser` now includes `email_verified: bool` (`false` for accounts created before this change until they verify).

## Endpoints
| Method & path | Auth | Body | 200 response | Errors |
|---|---|---|---|---|
| POST /auth/register | – | `{email, password(8–72), full_name?, referral_code?}` | 201 `TokenOut` | 409 `Email already registered` |
| POST /auth/login | – | `{email, password}` | `TokenOut` | 401 `Invalid email or password`, 429 |
| GET /auth/me | bearer | – | `PublicUser` | 401 |
| PATCH /auth/me | bearer | profile fields | `PublicUser` | 401, 422 |
| POST /auth/forgot-password | – | `{email}` | `{"ok": true}` **always**, whether or not the email exists | 429 (5/hour per email) |
| POST /auth/reset-password | – | `{token, new_password(8–72)}` | `TokenOut` (also marks email verified) | 400 `Invalid or expired token` |
| POST /auth/verify-email/request | bearer | – | `{"ok": true, "email_verified": bool}` | 401, 429 (5/hour) |
| POST /auth/verify-email/confirm | – | `{token}` | `PublicUser` | 400 `Invalid or expired token` |
| POST /auth/change-password | bearer | `{current_password, new_password(8–72)}` | `TokenOut` (other sessions revoked) | 401 `Current password is incorrect`, 429 |
| DELETE /auth/me | bearer | `{password}` | `{"ok": true}` | 401 `Password is incorrect`, 409 `Transfer or delete your communities first` |

## Email links
Reset and verify emails link to `${APP_PUBLIC_URL}/reset-password?token=…` and `/verify-email?token=…`
(default `ironflow://`). Tokens are single-use: reset expires in 1 hour, verify in 48 hours. Issuing a new one cancels the previous unused one.
Without `SMTP_HOST` (dev), emails are logged instead of sent. SMTP env: `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.

## Delete account
One cascade, `auth_account.AccountDeletion.run(user)`: removes the user, their workouts and sets, health data,
social content and graph, memberships, live participation/RSVPs, push tokens and auth tokens.
Accounting and audit records are retained. Hooks are marked in `external_hooks` for R2 media, RevenueCat and Stripe
(no client exists in the backend yet). Other features must call this cascade, not write their own.
