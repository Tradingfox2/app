/**
 * Mention tokens, shared by the composer that writes them and the message row
 * that renders them.
 *
 * The wire format is `<@id>` — an id, never a display name. Names are neither
 * unique nor stable, so resolving at render time is what keeps a message
 * readable after someone changes their name, and what stops a member typing
 * `@SomeoneElse` from impersonating a real mention.
 */
import type { MentionedUser } from "./api";

export const MENTION_PATTERN = /<@([A-Za-z0-9_-]{1,64})>/g;

export type MentionSegment = { text: string; mention: MentionedUser | null };

/** Split `content` into plain runs and mention runs, ready to render. */
export function segment(content: string, mentions: MentionedUser[] = []): MentionSegment[] {
  const byId = new Map(mentions.map((user) => [user.id, user]));
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: content.slice(cursor, start), mention: null });
    const user = byId.get(match[1]);
    // An unresolved id means the account is gone; show the raw token rather
    // than an empty gap, so the message still reads sensibly.
    segments.push(user ? { text: `@${user.full_name ?? "member"}`, mention: user } : { text: match[0], mention: null });
    cursor = start + match[0].length;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), mention: null });
  return segments.length ? segments : [{ text: content, mention: null }];
}

/**
 * The partial handle being typed, or null.
 *
 * Returns a query only when the caret sits in an unbroken run after an `@`, so
 * an email address or a mid-word `@` never opens the picker.
 */
export function activeQuery(draft: string): string | null {
  const match = /(^|\s)@([^\s@]{0,32})$/.exec(draft);
  return match ? match[2] : null;
}

/** Replace the in-progress `@query` at the end of `draft` with a real token. */
export function applyMention(draft: string, user: MentionedUser): string {
  return `${draft.replace(/(^|\s)@([^\s@]{0,32})$/, "$1")}<@${user.id}> `;
}
