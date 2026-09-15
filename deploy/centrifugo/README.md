# Centrifugo for IronFlow realtime

`config.json` is the server config for Centrifugo **v6** (checked with `centrifugo checkconfig` on v6.9.6).
The API works without it; the app just polls instead.

## What the config enforces

| Namespace | Who subscribes | Rule |
| --- | --- | --- |
| `channel:{id}` | the client, per chat room | Needs a subscription token from `GET /api/realtime/subscription-token`, which checks VIEW_CHANNEL first. There is no `allow_subscribe_for_client`, so a hidden room stays hidden. |
| `user:{id}` | the server, from the connection token's `channels` claim | DMs, typing, read receipts, mention nudges. A client cannot subscribe to someone else's. |
| `community:{id}` | publish only | Kept as a namespace so publishes are accepted. |

The `channel` and `user` namespaces keep 10 minutes of history with `force_recovery`, so a phone that
reconnects gets the messages it missed.

## Secrets: environment only, never the file

```sh
CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=<32+ random bytes>   # = backend CENTRIFUGO_TOKEN_SECRET
CENTRIFUGO_HTTP_API_KEY=<random>                             # = backend CENTRIFUGO_API_KEY
CENTRIFUGO_CLIENT_ALLOWED_ORIGINS="https://app.example.com"  # the web app origin(s), space-separated
centrifugo --config config.json
```

Backend:

```sh
CENTRIFUGO_URL=https://realtime.example.com   # the public origin; the app connects to <url>/connection/websocket
CENTRIFUGO_API_KEY=<same as CENTRIFUGO_HTTP_API_KEY>
CENTRIFUGO_TOKEN_SECRET=<same as the HMAC key>  # falls back to JWT_SECRET when unset; better kept separate
```

Put TLS in front (Caddy, nginx, or a managed load balancer) so the app connects over `wss://`.

## Verified locally

A throwaway Centrifugo v6.9.6 was run with this config, driven by tokens and publishes from `backend/realtime.py`
and received by the same `centrifuge` JS client the app uses. Results:

- a room without a token was refused (103);
- with the API's token the room was joined and the publish arrived;
- the member's own `user:` channel was delivered without any client subscription;
- another member's `user:` channel was refused.
