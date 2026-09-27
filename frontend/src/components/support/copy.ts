import { isTicketCategory, isTicketStatus, type TicketAuthorRole, type TicketCategory, type TicketStatus } from "@/src/api";

/** Matches the ticket handlers: subject is 1–120 after trim, message body is 1–5000. */
export const SUBJECT_MIN = 1;
export const SUBJECT_MAX = 120;
export const BODY_MAX = 5000;

export type SubjectIssue = "empty" | "long";

type Translate = (key: string) => string;

export function subjectIssue(subject: string): SubjectIssue | null {
  const value = subject.trim();
  if (value.length < SUBJECT_MIN) return "empty";
  if (value.length > SUBJECT_MAX) return "long";
  return null;
}

export function ticketCategoryLabel(category: TicketCategory, t: Translate): string {
  switch (category) {
    case "billing":
      return t("Billing");
    case "account":
      return t("Account");
    case "bug":
      return t("Bug");
    case "feature":
      return t("Feature request");
    case "other":
      return t("Other");
    default: {
      const exhaustive: never = category;
      return exhaustive;
    }
  }
}

export function ticketCategoryText(category: string, t: Translate): string {
  return isTicketCategory(category) ? ticketCategoryLabel(category, t) : category;
}

export function ticketStatusLabel(status: TicketStatus, t: Translate): string {
  switch (status) {
    case "open":
      return t("Open");
    case "pending":
      return t("Pending");
    case "closed":
      return t("Closed");
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function ticketStatusText(status: string, t: Translate): string {
  return isTicketStatus(status) ? ticketStatusLabel(status, t) : status.replaceAll("_", " ");
}

export type StatusTone = "brand" | "warning" | "muted";

export function statusTone(status: string): StatusTone {
  if (!isTicketStatus(status)) return "brand";
  switch (status) {
    case "open":
      return "brand";
    case "pending":
      return "warning";
    case "closed":
      return "muted";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function ticketAuthorLabel(role: TicketAuthorRole, t: Translate): string {
  switch (role) {
    case "user":
      return t("From you");
    case "staff":
      return t("Support team");
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}

export function ticketAuthorText(role: string, t: Translate): string {
  if (role === "user" || role === "staff") return ticketAuthorLabel(role, t);
  return role;
}
