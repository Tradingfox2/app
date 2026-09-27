import { isTicketCategory, type TicketAuthorRole, type TicketCategory } from "@/src/api";

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const BODY_MAX = 4000;

export type SubjectIssue = "empty" | "short" | "long";

type Translate = (key: string) => string;

export function subjectIssue(subject: string): SubjectIssue | null {
  const value = subject.trim();
  if (value.length === 0) return "empty";
  if (value.length < SUBJECT_MIN) return "short";
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

export function ticketStatusText(status: string, t: Translate): string {
  switch (status) {
    case "open":
    case "new":
      return t("Open");
    case "pending":
      return t("Pending");
    case "waiting":
      return t("Waiting on support");
    case "in_progress":
      return t("In progress");
    case "resolved":
      return t("Resolved");
    case "closed":
      return t("Closed");
    default:
      return status.replaceAll("_", " ");
  }
}

export type StatusTone = "brand" | "warning" | "muted" | "success";

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "open":
    case "new":
      return "brand";
    case "pending":
    case "waiting":
    case "in_progress":
      return "warning";
    case "resolved":
      return "success";
    case "closed":
      return "muted";
    default:
      return "brand";
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
