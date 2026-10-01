# Deploy IronFlow

The API is a FastAPI process (`backend/server.py`) on Python 3.12. It stores
data in MongoDB. Realtime chat is a second process, Centrifugo, and the app
keeps working without it by polling. This document is the first production
deploy: Atlas, the environment variables, and the first staff admin.

`render.yaml` at the repo root is a Render Blueprint with two web services:

| Service | Image | Health check |
| --- | --- | --- |
| `api` | `backend/Dockerfile` (uvicorn, non-root) | `GET /api/health` |
| `centrifugo` | `deploy/centrifugo/Dockerfile` (v6.9.6 plus `config.json`) | `GET /health` |

`GET /api/` is unchanged (`{"service":"ironflow","status":"ok"}`). CI still
waits on that path. `/api/health` is the readiness check: it pings Mongo and
reports whether an AI provider is configured. Mongo down returns HTTP 503.
A missing AI key does not.

## 1. MongoDB Atlas

1. Create a project and a free cluster (M0 is enough to start).
2. Database Access: add a database user with a password. Give it read and
   write on the IronFlow database. Do not use the Atlas admin account in the
   app.
3. Network Access: add the outbound addresses of the host that runs the API.
   On Render those are the [static outbound IPs](https://render.com/docs/outbound-ip-addresses)
   for the service's region, once you turn static IPs on. Until that list
   exists, Atlas can allow `0.0.0.0/0` so the first boot can connect. That
   entry allows any IP that has the database password, so replace it with
   the host's addresses before real users arrive.
4. Connect: choose Drivers and copy the `mongodb+srv://` string. Replace
   `<password>` with the database user's password (URL-encode characters such
   as `@` or `/`). The database name in the path is optional; the API uses
   `DB_NAME` separately.
5. Put that string in `MONGO_URL`. Set `DB_NAME` to `ironflow` unless you
   want a different database on the same cluster.

The API creates indexes on startup. It does not create the exercise catalog.
From `backend/`, with `MONGO_URL` and `DB_NAME` set:

```sh
python seed_scripts/seed.py
```

That upserts muscles and exercises. It is safe to run again.

## 2. Environment variables

The Blueprint stores these in two env groups, `ironflow-backend` and
`ironflow-integrations`, and the Centrifugo service has its own variables.
`sync: false` keys are typed into the Render dashboard at blueprint sync.
`generateValue: true` keys are created by Render. Leave a prompted key empty
when you are not using that feature.

### Required

| Variable | Role |
| --- | --- |
| `MONGO_URL` | Atlas connection string. The process refuses to start without it. |
| `JWT_SECRET` | Signs login tokens. Render generates it. If it is unset, each process invents a new secret and every existing login stops working at the next restart. |
| `DB_NAME` | Database name. Default `ironflow`. |

### App

| Variable | Role |
| --- | --- |
| `PUBLIC_APP_URL` | Browser origin used as the Stripe return URL. Default `http://localhost:8082`. |
| `APP_PUBLIC_URL` | Origin Terra redirects back to. Default `http://localhost:8082`. |
| `MODERATION_BACKEND` | `rules` (default) or `detoxify`. The image does not install Detoxify; leave this on `rules`. |
| `MODERATION_THRESHOLD` | Detoxify score cutoff. Default `0.8`. Unused on `rules`. |
| `DETOXIFY_MODEL` | Default `multilingual`. Unused on `rules`. |
| `RATE_LIMITS` | `on` (default). Set `off` to disable the Mongo counters. |
| `PUSH_ENABLED` | `on` (default). `off`, `0`, or `false` skips Expo push. |
| `DEMO_EMAILS` | Comma-separated accounts that may use demo wearable imports. Default `demo@ironflow.app`. |

The phone and web clients read `EXPO_PUBLIC_BACKEND_URL` at build time
(`frontend/src/api.ts`). Point it at the public API origin, including the
scheme, with no `/api` suffix. Share links use `EXPO_PUBLIC_WEB_ORIGIN` or
`EXPO_PUBLIC_WEB_URL` when you have a real web host. Those are client build
variables, not API process variables.

### AI

`LLM_PROVIDER` chooses the coach: `auto` (default), `anthropic`, `openrouter`,
or `ollama`. `GET /api/health` sets `ai_configured` only when the chosen
provider has credentials. `auto` with no keys, and unknown values such as
`none`, are not configured. Ollama counts only when `LLM_PROVIDER=ollama`.
The probe does not call the model.

| Variable | Role |
| --- | --- |
| `LLM_PROVIDER` | `auto`, `anthropic`, `openrouter`, or `ollama`. |
| `ANTHROPIC_API_KEY` | Claude. Required when the provider is Anthropic. |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-5`. |
| `ANTHROPIC_MODEL_PROGRAM` | Program generation. Default `claude-sonnet-5`. |
| `ANTHROPIC_MODEL_FAST` | Short coach lines. Default `claude-haiku-4-5`. |
| `ANTHROPIC_MODEL_LABS` | Lab reading. Default `claude-sonnet-4-6`. |
| `ANTHROPIC_EFFORT_PROGRAM` | Default `medium`. |
| `ANTHROPIC_BASE_URL` | Default `https://api.anthropic.com`. |
| `OPENROUTER_API_KEY` | OpenRouter. |
| `OPENROUTER_MODEL` | Default `anthropic/claude-sonnet-4.6`. |
| `OPENROUTER_BASE_URL` | Default `https://openrouter.ai/api/v1`. |
| `OLLAMA_BASE_URL` | Default `http://localhost:11434`. A localhost URL does nothing on Render; point it at a reachable Ollama host. |
| `OLLAMA_MODEL` | Default `qwen2.5:latest`. |
| `OLLAMA_VISION_MODEL` | Vision model for document OCR. Empty until you set one. |
| `LLM_TIMEOUT_SEC` | Default `240`. |
| `LLM_MAX_TOKENS` | Default `4096`. |

### Media

User photos and clips go to S3-compatible storage when `MEDIA_S3_BUCKET` is
set (Cloudflare R2, Backblaze B2, or AWS). `boto3` stays installed for that
path. Without a bucket, files are written under `backend/media`. Render's
container disk is wiped on every deploy, so production needs the bucket.

| Variable | Role |
| --- | --- |
| `MEDIA_S3_BUCKET` | Bucket name. Empty means local disk. |
| `MEDIA_S3_ENDPOINT` | Endpoint URL for R2 or B2. Leave empty for AWS. |
| `MEDIA_S3_ACCESS_KEY` | Access key. |
| `MEDIA_S3_SECRET_KEY` | Secret key. |
| `MEDIA_S3_REGION` | Default `auto`. |
| `MEDIA_PUBLIC_BASE_URL` | Public origin in front of the objects. Required if clients should load them from a CDN. |

### Realtime

Channel rules live in `deploy/centrifugo/config.json` and are explained in
`deploy/centrifugo/README.md`. The Dockerfile copies that file. Secrets in
the file are placeholders; the environment overrides them.

On the Centrifugo service:

| Variable | Role |
| --- | --- |
| `PORT` | `10000`, Render's usual web port. |
| `CENTRIFUGO_HTTP_SERVER_PORT` | Same value, so Centrifugo listens where Render sends traffic. |
| `CENTRIFUGO_HEALTH_ENABLED` | `true`. The check is `GET /health`. |
| `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` | Generated. Must equal the API's `CENTRIFUGO_TOKEN_SECRET`. |
| `CENTRIFUGO_HTTP_API_KEY` | Generated. Must equal the API's `CENTRIFUGO_API_KEY`. |
| `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` | The web app origin, or several origins separated by spaces. |

On the API, the Blueprint copies the two generated secrets across. Set
`CENTRIFUGO_URL` yourself to the Centrifugo service's public `https://` origin
(the `onrender.com` URL, no path). The API publishes to `<url>/api` and the
app opens `<url>/connection/websocket`. An internal hostname would let the
API publish and would leave phones unable to connect, because both use this
one variable. After the first Centrifugo deploy, paste its public URL into
`CENTRIFUGO_URL` and redeploy the API.

`CENTRIFUGO_TOKEN_TTL` defaults to `3600` seconds. Leave it unset unless you
need a different token life.

### Billing, labs, and wearables

These features already exist. Empty values turn the integration off; they do
not remove the routes.

| Variable | Role |
| --- | --- |
| `STRIPE_SECRET_KEY` | Community checkout. Stripe is called over HTTP; the Python `stripe` package is not required. |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /api/billing/stripe/webhook`. |
| `EMERGENT_LLM_KEY` | Private lab-report files in `backend/storage.py`. |
| `INTEGRATION_PROXY_URL` | Optional override. Default `https://integrations.emergentagent.com`. |
| `TERRA_DEV_ID` | Terra wearable and lab connection. |
| `TERRA_API_KEY` | Terra. |
| `TERRA_SIGNING_SECRET` | Required once Terra keys are set, or webhooks return 503. |
| `TERRA_WIDGET_URL` | Default `https://access.tryterra.co/api/widget/session`. |
| `TERRA_BASE_URL` | Default `https://access.tryterra.co/api`. |
| `TERRA_LABS_ENABLED` | `true` / `1` / `yes` turns lab fetch on. The Blueprint sets `false`. |
| `N8N_WEBHOOK_SECRET` | Shared secret for the n8n lab hook. |
| `TECHNOGYM_API_KEY` | Technogym, together with `TECHNOGYM_AUTH_DOMAIN`. |
| `TECHNOGYM_AUTH_DOMAIN` | Technogym OAuth host. |
| `TECHNOGYM_CLIENT_ID` | Technogym OAuth client id. |
| `EGYM_API_KEY` | eGym. |

## 3. First admin

Registration creates an athlete or a coach. It cannot create staff. There is
no API route that grants staff powers; the first admin is a console command
so a stranger cannot promote themselves.

1. Deploy the API and open the app (or `POST /api/auth/register`) and create
   the account that should run the back office. Remember the email.
2. On the API host, from the `backend/` directory, with the same `MONGO_URL`
   and `DB_NAME` the service uses:

   ```sh
   python seed_scripts/grant_staff.py you@example.com admin
   ```

   On Render that is the service shell. The script prints
   `you@example.com -> staff_role=admin`.

3. Sign out and sign in again so the new role is on the session you use next.
4. Later admins are granted in the app. The same script still works:

   | Command | Effect |
   | --- | --- |
   | `python seed_scripts/grant_staff.py you@example.com admin` | Full staff admin |
   | `python seed_scripts/grant_staff.py you@example.com moderator` | Moderator |
   | `python seed_scripts/grant_staff.py you@example.com support` | Support |
   | `python seed_scripts/grant_staff.py you@example.com none` | Remove staff powers |

   Any other role prints the allowed names and exits with code 2. An email
   that is not registered prints `No user with email ...` and exits with
   code 1.

## 4. Local API container

From the repo root, with Atlas or a local Mongo already running:

```sh
docker build -f backend/Dockerfile backend
docker run --rm -p 8001:8001 \
  -e MONGO_URL='mongodb://host.docker.internal:27017' \
  -e DB_NAME=ironflow \
  -e JWT_SECRET='a-long-random-string' \
  -e LLM_PROVIDER=none \
  <image>
```

`GET http://127.0.0.1:8001/api/health` returns `mongo: true` when the ping
works. The process listens on `PORT` (default `8001`) as a non-root user.
The image's health check calls the same path.
