/**
 * Mirror of `backend/permissions.py`.
 *
 * The server is the authority — this exists so the UI can hide an action the
 * API would refuse, rather than offering a button that returns 403. Any change
 * to the bit values here must be made in lockstep with the backend module.
 */

export const VIEW_CHANNEL = 1 << 0;
export const SEND_MESSAGE = 1 << 1;
export const ATTACH_MEDIA = 1 << 2;
export const ADD_REACTION = 1 << 3;
export const MENTION_EVERYONE = 1 << 4;
export const PIN_MESSAGE = 1 << 5;
export const MANAGE_MESSAGES = 1 << 6;
export const MANAGE_CHANNEL = 1 << 7;
export const INVITE_MEMBER = 1 << 8;
export const KICK_MEMBER = 1 << 9;
export const MANAGE_ROLES = 1 << 10;
export const POST_PROGRAM = 1 << 11;
export const START_LIVE_SESSION = 1 << 12;
export const VIEW_MEMBER_PROGRESS = 1 << 13;

/** Ordered for the permission matrix in the role editor. */
export const PERMISSION_LIST = [
  { bit: VIEW_CHANNEL, key: "VIEW_CHANNEL", label: "View channel" },
  { bit: SEND_MESSAGE, key: "SEND_MESSAGE", label: "Send messages" },
  { bit: ATTACH_MEDIA, key: "ATTACH_MEDIA", label: "Attach media" },
  { bit: ADD_REACTION, key: "ADD_REACTION", label: "Add reactions" },
  { bit: MENTION_EVERYONE, key: "MENTION_EVERYONE", label: "Mention everyone" },
  { bit: PIN_MESSAGE, key: "PIN_MESSAGE", label: "Pin messages" },
  { bit: MANAGE_MESSAGES, key: "MANAGE_MESSAGES", label: "Manage messages" },
  { bit: MANAGE_CHANNEL, key: "MANAGE_CHANNEL", label: "Manage channels" },
  { bit: INVITE_MEMBER, key: "INVITE_MEMBER", label: "Invite members" },
  { bit: KICK_MEMBER, key: "KICK_MEMBER", label: "Remove members" },
  { bit: MANAGE_ROLES, key: "MANAGE_ROLES", label: "Manage roles" },
  { bit: POST_PROGRAM, key: "POST_PROGRAM", label: "Post programs" },
  { bit: START_LIVE_SESSION, key: "START_LIVE_SESSION", label: "Start live sessions" },
  { bit: VIEW_MEMBER_PROGRESS, key: "VIEW_MEMBER_PROGRESS", label: "View member progress" },
] as const;

export const DEFAULT_MEMBER =
  VIEW_CHANNEL | SEND_MESSAGE | ATTACH_MEDIA | ADD_REACTION | INVITE_MEMBER;

/** True when `mask` carries every bit in `permission`. */
export function can(mask: number | null | undefined, permission: number): boolean {
  return ((mask ?? 0) & permission) === permission;
}

export function toggle(mask: number, permission: number): number {
  return can(mask, permission) ? mask & ~permission : mask | permission;
}

export function describe(mask: number | null | undefined): string[] {
  return PERMISSION_LIST.filter((entry) => can(mask, entry.bit)).map((entry) => entry.label);
}
