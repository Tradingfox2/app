# Post deep links

A post lives at Expo Router `frontend/app/post/[id].tsx`. Sharing uses one helper, `frontend/src/share.ts`.

| When | URL |
| --- | --- |
| `EXPO_PUBLIC_WEB_ORIGIN` or `EXPO_PUBLIC_WEB_URL` is an `http(s)` origin | `{origin}/post/{id}` |
| Otherwise | `ironflow://post/{id}` |

`ironflow` is `expo.scheme` in `frontend/app.json`. The path is the route, so `ironflow://post/abc` opens the same screen as `/post/abc` on web. Expo Linking treats the first segment after `://` as part of the path, which is why the link is `ironflow://post/{id}` and not a triple-slash URL.

`buildPostUrl(id)` returns that string. `sharePost({ id, title?, message? })` opens the system share sheet with the title, an optional snippet, and the URL. Copy and the X, Facebook, WhatsApp, and LinkedIn buttons use the same URL and open that network's composer. They do not show a success toast.

Set the origin to the deployed web host, without a trailing slash, for example `https://app.example.com`. The host must serve the Expo web app at `/post/{id}`.

## Profile → post → feed

Own profile (`You` → View profile) uses the same composer as the community feed (`POST /posts`, optional `POST /media`). The new post is stored by the API, shown on that profile wall, and listed by `GET /feed`. Follow on someone else's profile calls the existing follow API. It does not use a second graph.
