import { Ionicons } from "@expo/vector-icons";

export type Tab = "overview" | "analytics" | "accounting" | "support" | "reports" | "coaches" | "joins" | "communities" | "users" | "team" | "audit";
export type CoachFilter = "pending" | "approved" | "rejected" | "suspended";
export type AccountStatus = "all" | "active" | "suspended" | "staff";
export const MEMBERSHIP_STATUSES = ["pending", "banned", "removed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const REPORT_TARGET_TYPES = ["post", "comment", "message", "direct_message", "user", "community"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Desktop groups. The same tab ids stay in the URL and in `admin-tab-*` test ids. */
export const NAV_GROUPS: { id: string; label: string; ids: Tab[] }[] = [
  { id: "operations", label: "Operations", ids: ["overview", "reports", "support"] },
  { id: "people", label: "People", ids: ["users", "coaches", "joins", "communities"] },
  { id: "business", label: "Business", ids: ["analytics", "accounting"] },
  { id: "administration", label: "Administration", ids: ["team", "audit"] },
];

export const NAV: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "overview", label: "OVERVIEW", icon: "grid-outline" },
  { id: "analytics", label: "ANALYTICS", icon: "pulse-outline" },
  { id: "accounting", label: "ACCOUNTING", icon: "cash-outline" },
  { id: "support", label: "SUPPORT", icon: "chatbubbles-outline" },
  { id: "reports", label: "REPORTS", icon: "flag-outline" },
  { id: "coaches", label: "COACHES", icon: "ribbon-outline" },
  { id: "joins", label: "Memberships", icon: "enter-outline" },
  { id: "communities", label: "COMMUNITIES", icon: "people-outline" },
  { id: "users", label: "USERS", icon: "person-outline" },
  { id: "team", label: "TEAM", icon: "shield-checkmark-outline" },
  { id: "audit", label: "AUDIT", icon: "list-outline" },
];

export const RESOLUTIONS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "dismissed", label: "DISMISS", icon: "close-circle-outline" },
  { key: "warning_sent", label: "WARN", icon: "alert-circle-outline" },
  { key: "content_removed", label: "REMOVE", icon: "trash-outline" },
  { key: "user_suspended", label: "SUSPEND", icon: "lock-closed-outline" },
];

const TABS: readonly Tab[] = NAV.map(item => item.id);

export function isTab(value: string | null): value is Tab {
  return value != null && (TABS as readonly string[]).includes(value);
}

export function membershipStatusLabel(status: MembershipStatus): string {
  switch (status) {
    case "pending":
      return "Waiting";
    case "banned":
      return "Banned";
    case "removed":
      return "Removed";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function reportTypeLabel(type: ReportTargetType): string {
  switch (type) {
    case "post":
      return "Post";
    case "comment":
      return "Comment";
    case "message":
      return "Message";
    case "direct_message":
      return "Direct message";
    case "user":
      return "User";
    case "community":
      return "Community";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function isReportTargetType(value: string): value is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

export function isCoachFilter(value: string | null): value is CoachFilter {
  return value === "pending" || value === "approved" || value === "rejected" || value === "suspended";
}

export function isAccountStatus(value: string | null): value is AccountStatus {
  return value === "all" || value === "active" || value === "suspended" || value === "staff";
}

export function isMembershipStatus(value: string | null): value is MembershipStatus {
  return value === "pending" || value === "banned" || value === "removed";
}

export function isTicketStatus(value: string | null): value is "open" | "pending" | "closed" {
  return value === "open" || value === "pending" || value === "closed";
}

/** `to` on the audit API is exclusive, so the selected calendar day needs the next midnight. */
export function exclusiveEnd(day: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const [year, month, date] = day.split("-").map(Number);
  const stamp = new Date(Date.UTC(year, month - 1, date));
  if (Number.isNaN(stamp.getTime()) || stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1) return undefined;
  stamp.setUTCDate(stamp.getUTCDate() + 1);
  return `${stamp.toISOString().slice(0, 19)}Z`;
}
