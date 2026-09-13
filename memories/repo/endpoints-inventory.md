# Endpoints Inventory

> Repository memory for the IronFlow Cartographer. Generated from source on
> 2026-09-14, branch `feature/interactive-muscle-explorer`. All paths are served
> under the `/api` prefix (`api.include_router(...)` then `app.include_router(api)`).
**130 routes total.**

> Regenerate rather than hand-edit.

## `backend/server.py` (29)

- `GET    /api/` -> `root`
- `POST   /api/auth/login` -> `login`
- `GET    /api/auth/me` -> `me`
- `PATCH  /api/auth/me` -> `update_me`
- `POST   /api/auth/register` -> `register`
- `GET    /api/biomarkers` -> `list_biomarkers`
- `POST   /api/biomarkers` -> `add_biomarker`
- `GET    /api/coach/relationships` -> `list_relationships`
- `PATCH  /api/coach/relationships/{rel_id}` -> `update_relationship`
- `POST   /api/coach/request` -> `request_coach`
- `GET    /api/dashboard` -> `dashboard`
- `GET    /api/exercises` -> `list_exercises`
- `GET    /api/group-sessions` -> `list_sessions`
- `POST   /api/group-sessions` -> `create_session`
- `GET    /api/muscles` -> `list_muscles`
- `GET    /api/progression/{exercise_id}` -> `progression`
- `GET    /api/realtime/token` -> `realtime_token`
- `GET    /api/referrals/mine` -> `my_referrals`
- `POST   /api/subscriptions` -> `upsert_sub`
- `GET    /api/subscriptions/current` -> `current_sub`
- `GET    /api/wearable-metrics` -> `list_wearable`
- `POST   /api/wearable-metrics` -> `add_wearable`
- `GET    /api/workouts` -> `list_workouts`
- `POST   /api/workouts` -> `create_workout`
- `GET    /api/workouts/{workout_id}` -> `get_workout`
- `POST   /api/workouts/{workout_id}/finish` -> `finish_workout`
- `POST   /api/workouts/{workout_id}/plan` -> `plan_exercises`
- `GET    /api/workouts/{workout_id}/sets` -> `list_sets`
- `POST   /api/workouts/{workout_id}/sets` -> `add_set`

## `backend/routers/admin.py` (11)

- `GET    /api/admin/audit-log` -> `audit_log`
- `GET    /api/admin/overview` -> `overview`
- `GET    /api/admin/reports` -> `list_reports`
- `PATCH  /api/admin/reports/{report_id}` -> `review_report`
- `GET    /api/admin/users` -> `list_users`
- `GET    /api/admin/users/{user_id}` -> `user_detail`
- `POST   /api/admin/users/{user_id}/notes` -> `add_note`
- `POST   /api/admin/users/{user_id}/reinstate` -> `reinstate_user`
- `PATCH  /api/admin/users/{user_id}/staff-role` -> `set_staff_role`
- `POST   /api/admin/users/{user_id}/suspend` -> `suspend_user`
- `POST   /api/reports` -> `create_report`

## `backend/routers/community.py` (37)

- `GET    /api/admin/coach-applications` -> `list_coach_applications`
- `PATCH  /api/admin/coach-applications/{application_id}` -> `review_coach_application`
- `GET    /api/channels/{channel_id}` -> `get_channel`
- `PATCH  /api/channels/{channel_id}` -> `update_channel`
- `DELETE /api/channels/{channel_id}` -> `archive_channel`
- `GET    /api/channels/{channel_id}/messages` -> `list_messages`
- `POST   /api/channels/{channel_id}/messages` -> `create_message`
- `PUT    /api/channels/{channel_id}/overwrites` -> `set_channel_overwrites`
- `GET    /api/channels/{channel_id}/pins` -> `list_pins`
- `PATCH  /api/channels/{channel_id}/ranking` -> `update_channel_ranking`
- `GET    /api/coach/application` -> `get_coach_application`
- `POST   /api/coach/applications` -> `apply_to_coach`
- `GET    /api/coaches` -> `list_coaches`
- `GET    /api/communities` -> `list_communities`
- `POST   /api/communities` -> `create_community`
- `GET    /api/communities/{community_id}` -> `get_community`
- `PATCH  /api/communities/{community_id}` -> `update_community`
- `DELETE /api/communities/{community_id}` -> `archive_community`
- `GET    /api/communities/{community_id}/channels` -> `list_channels`
- `POST   /api/communities/{community_id}/channels` -> `create_channel`
- `POST   /api/communities/{community_id}/join` -> `join_community`
- `GET    /api/communities/{community_id}/members` -> `list_members`
- `PATCH  /api/communities/{community_id}/members/{member_id}` -> `review_membership`
- `PUT    /api/communities/{community_id}/members/{member_id}/roles` -> `assign_member_roles`
- `DELETE /api/communities/{community_id}/membership` -> `leave_community`
- `GET    /api/communities/{community_id}/roles` -> `list_roles`
- `POST   /api/communities/{community_id}/roles` -> `create_role`
- `GET    /api/community-rankings` -> `community_rankings`
- `PATCH  /api/messages/{message_id}` -> `edit_message`
- `DELETE /api/messages/{message_id}` -> `delete_message`
- `POST   /api/messages/{message_id}/pin` -> `pin_message`
- `DELETE /api/messages/{message_id}/pin` -> `unpin_message`
- `POST   /api/messages/{message_id}/reactions` -> `add_reaction`
- `DELETE /api/messages/{message_id}/reactions` -> `remove_reaction`
- `GET    /api/partner/dashboard` -> `partner_dashboard`
- `PATCH  /api/roles/{role_id}` -> `update_role`
- `DELETE /api/roles/{role_id}` -> `delete_role`

## `backend/routers/labs.py` (5)

- `GET    /api/biomarkers/grouped` -> `biomarkers_grouped`
- `GET    /api/labs/reports` -> `list_reports`
- `GET    /api/labs/reports/{report_id}` -> `get_report`
- `POST   /api/labs/upload` -> `upload_lab`
- `POST   /api/webhooks/n8n/labs` -> `n8n_labs_callback`

## `backend/routers/muscles.py` (5)

- `GET    /api/coach/models/ollama` -> `coach_ollama_models`
- `POST   /api/coach/muscle-circuit` -> `ai_muscle_circuit`
- `GET    /api/coach/status` -> `coach_status`
- `GET    /api/muscle-heatmap` -> `muscle_heatmap`
- `GET    /api/muscles/{muscle_slug}/recommendations` -> `muscle_recommendations`

## `backend/routers/notifications.py` (4)

- `GET    /api/notifications` -> `list_notifications`
- `POST   /api/notifications/read-all` -> `mark_all_read`
- `GET    /api/notifications/unread-count` -> `unread_count`
- `POST   /api/notifications/{notification_id}/read` -> `mark_read`

## `backend/routers/program.py` (3)

- `POST   /api/coach/adjust` -> `adjust_today`
- `POST   /api/coach/generate` -> `generate_program`
- `GET    /api/programs` -> `list_programs`

## `backend/routers/social.py` (24)

- `GET    /api/dm` -> `list_threads`
- `GET    /api/dm/{peer_id}/messages` -> `thread_messages`
- `POST   /api/dm/{peer_id}/messages` -> `send_direct_message`
- `GET    /api/feed` -> `feed`
- `GET    /api/follow-requests` -> `follow_requests`
- `DELETE /api/follow-requests/{follower_id}` -> `deny_follow_request`
- `POST   /api/follow-requests/{follower_id}/approve` -> `approve_follow_request`
- `POST   /api/media` -> `upload_media`
- `POST   /api/posts` -> `create_post`
- `DELETE /api/posts/{post_id}` -> `delete_post`
- `GET    /api/posts/{post_id}/comments` -> `list_comments`
- `POST   /api/posts/{post_id}/comments` -> `add_comment`
- `POST   /api/posts/{post_id}/like` -> `like_post`
- `DELETE /api/posts/{post_id}/like` -> `unlike_post`
- `POST   /api/posts/{post_id}/repost` -> `repost`
- `POST   /api/users/{user_id}/block` -> `block_user`
- `DELETE /api/users/{user_id}/block` -> `unblock_user`
- `POST   /api/users/{user_id}/follow` -> `follow`
- `DELETE /api/users/{user_id}/follow` -> `unfollow`
- `GET    /api/users/{user_id}/followers` -> `followers`
- `GET    /api/users/{user_id}/following` -> `following`
- `POST   /api/users/{user_id}/mute` -> `mute_user`
- `DELETE /api/users/{user_id}/mute` -> `unmute_user`
- `GET    /api/users/{user_id}/profile` -> `public_profile`

## `backend/routers/wearables.py` (10)

- `GET    /api/gyms` -> `list_gyms`
- `POST   /api/gyms/checkin` -> `gym_checkin`
- `GET    /api/gyms/visits` -> `my_visits`
- `GET    /api/wearables/sources` -> `list_sources`
- `POST   /api/wearables/sources/samsung_health/import` -> `import_samsung_health`
- `POST   /api/wearables/sources/{provider}/connect` -> `connect_source`
- `POST   /api/wearables/sources/{provider}/disconnect` -> `disconnect_source`
- `POST   /api/wearables/sources/{provider}/sync` -> `sync_source`
- `POST   /api/webhooks/technogym` -> `technogym_webhook`
- `POST   /api/webhooks/terra` -> `terra_webhook`

## `backend/tips.py` (2)

- `GET    /api/coach/tip` -> `coach_tip`
- `GET    /api/tips/daily` -> `tips_daily`
