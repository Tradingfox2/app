# Endpoints Inventory

> Repository memory for the IronFlow Cartographer. Generated from the route
> decorators on 2026-09-15 (branch `feature/interactive-muscle-explorer`).
> All paths are under `/api`. Regenerate rather than hand-edit.

**188 routes.**

## `backend/server.py` (29)

| Method | Path | Handler |
|---|---|---|
| GET | `/` | `root` |
| POST | `/auth/register` | `register` |
| POST | `/auth/login` | `login` |
| GET | `/auth/me` | `me` |
| GET | `/realtime/token` | `realtime_token` |
| PATCH | `/auth/me` | `update_me` |
| GET | `/muscles` | `list_muscles` |
| GET | `/exercises` | `list_exercises` |
| GET | `/workouts` | `list_workouts` |
| POST | `/workouts` | `create_workout` |
| GET | `/workouts/{workout_id}` | `get_workout` |
| POST | `/workouts/{workout_id}/plan` | `plan_exercises` |
| POST | `/workouts/{workout_id}/finish` | `finish_workout` |
| GET | `/workouts/{workout_id}/sets` | `list_sets` |
| POST | `/workouts/{workout_id}/sets` | `add_set` |
| GET | `/biomarkers` | `list_biomarkers` |
| POST | `/biomarkers` | `add_biomarker` |
| GET | `/wearable-metrics` | `list_wearable` |
| POST | `/wearable-metrics` | `add_wearable` |
| GET | `/dashboard` | `dashboard` |
| GET | `/coach/relationships` | `list_relationships` |
| POST | `/coach/request` | `request_coach` |
| PATCH | `/coach/relationships/{rel_id}` | `update_relationship` |
| GET | `/group-sessions` | `list_sessions` |
| POST | `/group-sessions` | `create_session` |
| GET | `/subscriptions/current` | `current_sub` |
| POST | `/subscriptions` | `upsert_sub` |
| GET | `/referrals/mine` | `my_referrals` |
| GET | `/progression/{exercise_id}` | `progression` |

## `backend/routers/admin.py` (11)

| Method | Path | Handler |
|---|---|---|
| POST | `/reports` | `create_report` |
| GET | `/admin/overview` | `overview` |
| GET | `/admin/users` | `list_users` |
| GET | `/admin/users/{user_id}` | `user_detail` |
| POST | `/admin/users/{user_id}/notes` | `add_note` |
| POST | `/admin/users/{user_id}/suspend` | `suspend_user` |
| POST | `/admin/users/{user_id}/reinstate` | `reinstate_user` |
| PATCH | `/admin/users/{user_id}/staff-role` | `set_staff_role` |
| GET | `/admin/reports` | `list_reports` |
| PATCH | `/admin/reports/{report_id}` | `review_report` |
| GET | `/admin/audit-log` | `audit_log` |

## `backend/routers/community.py` (73)

| Method | Path | Handler |
|---|---|---|
| POST | `/coach/applications` | `apply_to_coach` |
| GET | `/coach/application` | `get_coach_application` |
| PATCH | `/admin/coach-applications/{application_id}` | `review_coach_application` |
| GET | `/admin/coach-applications` | `list_coach_applications` |
| GET | `/coaches` | `list_coaches` |
| GET | `/communities` | `list_communities` |
| POST | `/communities` | `create_community` |
| GET | `/communities/{community_id}` | `get_community` |
| PATCH | `/communities/{community_id}` | `update_community` |
| POST | `/communities/{community_id}/join` | `join_community` |
| POST | `/communities/{community_id}/checkout` | `start_checkout` |
| POST | `/billing/stripe/webhook` | `stripe_webhook` |
| GET | `/communities/{community_id}/members` | `list_members` |
| PATCH | `/communities/{community_id}/members/{member_id}` | `review_membership` |
| POST | `/communities/{community_id}/members/{member_id}/timeout` | `timeout_member` |
| DELETE | `/communities/{community_id}` | `archive_community` |
| GET | `/communities-archived` | `list_archived_communities` |
| POST | `/communities/{community_id}/restore` | `restore_community` |
| POST | `/communities/{community_id}/transfer` | `transfer_ownership` |
| POST | `/communities/{community_id}/onboarding` | `complete_onboarding` |
| GET | `/communities/{community_id}/audit-log` | `community_audit_log` |
| GET | `/communities/{community_id}/reports` | `community_reports` |
| PATCH | `/communities/{community_id}/reports/{report_id}` | `review_community_report` |
| GET | `/communities/{community_id}/insights` | `community_insights` |
| DELETE | `/communities/{community_id}/membership` | `leave_community` |
| GET | `/communities/{community_id}/roles` | `list_roles` |
| POST | `/communities/{community_id}/roles` | `create_role` |
| PATCH | `/roles/{role_id}` | `update_role` |
| DELETE | `/roles/{role_id}` | `delete_role` |
| PUT | `/communities/{community_id}/members/{member_id}/roles` | `assign_member_roles` |
| PUT | `/channels/{channel_id}/overwrites` | `set_channel_overwrites` |
| GET | `/communities/{community_id}/channels` | `list_channels` |
| PUT | `/communities/{community_id}/channel-order` | `reorder_channels` |
| POST | `/communities/{community_id}/channels` | `create_channel` |
| GET | `/channels/{channel_id}` | `get_channel` |
| PATCH | `/channels/{channel_id}` | `update_channel` |
| DELETE | `/channels/{channel_id}` | `archive_channel` |
| PATCH | `/channels/{channel_id}/ranking` | `update_channel_ranking` |
| GET | `/channels/{channel_id}/messages` | `list_messages` |
| POST | `/channels/{channel_id}/messages` | `create_message` |
| POST | `/messages/{message_id}/reactions` | `add_reaction` |
| DELETE | `/messages/{message_id}/reactions` | `remove_reaction` |
| PATCH | `/messages/{message_id}` | `edit_message` |
| DELETE | `/messages/{message_id}` | `delete_message` |
| POST | `/messages/{message_id}/pin` | `pin_message` |
| DELETE | `/messages/{message_id}/pin` | `unpin_message` |
| GET | `/channels/{channel_id}/pins` | `list_pins` |
| GET | `/channels/{channel_id}/search` | `search_channel` |
| POST | `/channels/{channel_id}/typing` | `channel_typing` |
| GET | `/realtime/subscription-token` | `realtime_subscription_token` |
| POST | `/channels/{channel_id}/read` | `mark_channel_read` |
| GET | `/communities/{community_id}/directory` | `member_directory` |
| POST | `/communities/{community_id}/invites` | `create_invite` |
| GET | `/communities/{community_id}/invites` | `list_invites` |
| DELETE | `/invites/{code}` | `revoke_invite` |
| GET | `/invites/{code}` | `preview_invite` |
| POST | `/invites/{code}/redeem` | `redeem_invite` |
| GET | `/channels/{channel_id}/checkins` | `checkin_board` |
| POST | `/channels/{channel_id}/challenge/participants` | `join_challenge` |
| DELETE | `/channels/{channel_id}/challenge/participants` | `leave_challenge` |
| GET | `/channels/{channel_id}/challenge` | `challenge_board` |
| POST | `/channels/{channel_id}/programs` | `share_program` |
| GET | `/channels/{channel_id}/programs` | `list_shared_programs` |
| POST | `/messages/{message_id}/adopt-program` | `adopt_program` |
| POST | `/channels/{channel_id}/live-sessions` | `schedule_live_session` |
| GET | `/channels/{channel_id}/live-sessions` | `list_live_sessions` |
| POST | `/live-sessions/{session_id}/rsvp` | `rsvp_live_session` |
| DELETE | `/live-sessions/{session_id}/rsvp` | `cancel_rsvp` |
| POST | `/live-sessions/{session_id}/start` | `start_live_session` |
| POST | `/live-sessions/{session_id}/end` | `end_live_session` |
| DELETE | `/live-sessions/{session_id}` | `cancel_live_session` |
| GET | `/partner/dashboard` | `partner_dashboard` |
| GET | `/community-rankings` | `community_rankings` |

## `backend/routers/labs.py` (5)

| Method | Path | Handler |
|---|---|---|
| POST | `/labs/upload` | `upload_lab` |
| GET | `/labs/reports` | `list_reports` |
| GET | `/labs/reports/{report_id}` | `get_report` |
| GET | `/biomarkers/grouped` | `biomarkers_grouped` |
| POST | `/webhooks/n8n/labs` | `n8n_labs_callback` |

## `backend/routers/muscles.py` (5)

| Method | Path | Handler |
|---|---|---|
| GET | `/muscle-heatmap` | `muscle_heatmap` |
| GET | `/muscles/{muscle_slug}/recommendations` | `muscle_recommendations` |
| POST | `/coach/muscle-circuit` | `ai_muscle_circuit` |
| GET | `/coach/status` | `coach_status` |
| GET | `/coach/models/ollama` | `coach_ollama_models` |

## `backend/routers/notifications.py` (10)

| Method | Path | Handler |
|---|---|---|
| GET | `/notifications` | `list_notifications` |
| GET | `/notifications/unread-count` | `unread_count` |
| POST | `/notifications/{notification_id}/read` | `mark_read` |
| POST | `/notifications/read-all` | `mark_all_read` |
| DELETE | `/notifications/{notification_id}` | `delete_notification` |
| DELETE | `/notifications` | `clear_read_notifications` |
| GET | `/notifications/preferences` | `get_preferences` |
| PUT | `/notifications/preferences` | `update_preferences` |
| POST | `/push-tokens` | `register_push_token` |
| DELETE | `/push-tokens` | `unregister_push_token` |

## `backend/routers/program.py` (3)

| Method | Path | Handler |
|---|---|---|
| POST | `/coach/generate` | `generate_program` |
| GET | `/programs` | `list_programs` |
| POST | `/coach/adjust` | `adjust_today` |

## `backend/routers/search.py` (1)

| Method | Path | Handler |
|---|---|---|
| GET | `/search` | `search` |

## `backend/routers/social.py` (39)

| Method | Path | Handler |
|---|---|---|
| POST | `/media` | `upload_media` |
| GET | `/feed` | `feed` |
| POST | `/posts` | `create_post` |
| GET | `/posts/{post_id}` | `get_post` |
| PATCH | `/posts/{post_id}` | `edit_post` |
| DELETE | `/posts/{post_id}` | `delete_post` |
| POST | `/posts/{post_id}/like` | `like_post` |
| DELETE | `/posts/{post_id}/like` | `unlike_post` |
| POST | `/posts/{post_id}/repost` | `repost` |
| DELETE | `/posts/{post_id}/repost` | `undo_repost` |
| GET | `/posts/{post_id}/comments` | `list_comments` |
| POST | `/posts/{post_id}/comments` | `add_comment` |
| PATCH | `/comments/{comment_id}` | `edit_comment` |
| DELETE | `/comments/{comment_id}` | `delete_comment` |
| POST | `/comments/{comment_id}/like` | `like_comment` |
| DELETE | `/comments/{comment_id}/like` | `unlike_comment` |
| POST | `/posts/{post_id}/save` | `save_post` |
| DELETE | `/posts/{post_id}/save` | `unsave_post` |
| GET | `/saved` | `saved_posts` |
| POST | `/posts/{post_id}/vote` | `vote` |
| GET | `/tags/trending` | `trending_tags` |
| POST | `/users/{user_id}/follow` | `follow` |
| DELETE | `/users/{user_id}/follow` | `unfollow` |
| GET | `/follow-requests` | `follow_requests` |
| POST | `/follow-requests/{follower_id}/approve` | `approve_follow_request` |
| DELETE | `/follow-requests/{follower_id}` | `deny_follow_request` |
| GET | `/users/{user_id}/followers` | `followers` |
| GET | `/users/{user_id}/following` | `following` |
| POST | `/users/{user_id}/block` | `block_user` |
| DELETE | `/users/{user_id}/block` | `unblock_user` |
| POST | `/users/{user_id}/mute` | `mute_user` |
| DELETE | `/users/{user_id}/mute` | `unmute_user` |
| GET | `/users/{user_id}/profile` | `public_profile` |
| GET | `/dm` | `list_threads` |
| GET | `/dm/unread-count` | `dm_unread_count` |
| GET | `/dm/{peer_id}/messages` | `thread_messages` |
| POST | `/dm/{peer_id}/messages` | `send_direct_message` |
| DELETE | `/dm/messages/{message_id}` | `delete_direct_message` |
| POST | `/dm/{peer_id}/typing` | `dm_typing` |

## `backend/routers/wearables.py` (10)

| Method | Path | Handler |
|---|---|---|
| GET | `/wearables/sources` | `list_sources` |
| POST | `/wearables/sources/{provider}/connect` | `connect_source` |
| POST | `/wearables/sources/samsung_health/import` | `import_samsung_health` |
| POST | `/wearables/sources/{provider}/disconnect` | `disconnect_source` |
| POST | `/wearables/sources/{provider}/sync` | `sync_source` |
| POST | `/webhooks/terra` | `terra_webhook` |
| POST | `/webhooks/technogym` | `technogym_webhook` |
| GET | `/gyms` | `list_gyms` |
| POST | `/gyms/checkin` | `gym_checkin` |
| GET | `/gyms/visits` | `my_visits` |

## `backend/tips.py` (2)

| Method | Path | Handler |
|---|---|---|
| GET | `/tips/daily` | `tips_daily` |
| GET | `/coach/tip` | `coach_tip` |
