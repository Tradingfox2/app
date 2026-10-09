import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  AdminAccount,
  AdminCoach,
  AdminCommunity,
  AdminMembership,
  AdminOverview,
  api,
  AuditEntry,
  AuditQuery,
  CoachApplicationReview,
  HealthReport,
  ModerationReport,
  StaffRole,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketStatus,
} from "@/src/api";
import { track } from "@/src/analytics";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import {
  AccountStatus,
  CoachFilter,
  exclusiveEnd,
  isAccountStatus,
  isCoachFilter,
  isMembershipStatus,
  isReportTargetType,
  isTab,
  isTicketStatus,
  MembershipStatus,
  ReportTargetType,
  Tab,
} from "./admin-labels";
import { isAbortError, readConsoleQuery, writeConsoleQuery } from "./console-query";

type SectionErrors = {
  reports?: string;
  users?: string;
  audit?: string;
  support?: string;
  joins?: string;
  communities?: string;
  coaches?: string;
  team?: string;
};

type SectionTimes = {
  reports?: string;
  users?: string;
  audit?: string;
  support?: string;
  joins?: string;
  communities?: string;
  coaches?: string;
  team?: string;
};

function initialParams() {
  return readConsoleQuery();
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function useAdminConsole() {
  const { user, logout } = useAuth();
  const { t, formatDate, formatNumber } = useI18n();
  const params = initialParams();
  const [tab, setTabState] = useState<Tab>(() => (isTab(params.get("tab")) ? params.get("tab") as Tab : "overview"));
  const [coachFilter, setCoachFilter] = useState<CoachFilter>(() => (isCoachFilter(params.get("coach")) ? params.get("coach") as CoachFilter : "pending"));
  const [coachDirectory, setCoachDirectory] = useState<AdminCoach[] | null>(null);
  const [coachTotal, setCoachTotal] = useState<number | null>(null);
  const [coachCursor, setCoachCursor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [reportTotal, setReportTotal] = useState<number | null>(null);
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<"open" | "resolved">(() => (params.get("reportStatus") === "resolved" ? "resolved" : "open"));
  const [reportType, setReportType] = useState<ReportTargetType | "all">(() => {
    const value = params.get("reportType");
    return value && isReportTargetType(value) ? value : "all";
  });
  const [joins, setJoins] = useState<AdminMembership[]>([]);
  const [joinTotal, setJoinTotal] = useState<number | null>(null);
  const [joinCursor, setJoinCursor] = useState<string | null>(null);
  const [joinStatus, setJoinStatus] = useState<MembershipStatus>(() => (isMembershipStatus(params.get("join")) ? params.get("join") as MembershipStatus : "pending"));
  const [communities, setCommunities] = useState<AdminCommunity[]>([]);
  const [communityTotal, setCommunityTotal] = useState<number | null>(null);
  const [communityCursor, setCommunityCursor] = useState<string | null>(null);
  const [team, setTeam] = useState<AdminAccount[]>([]);
  const [teamTotal, setTeamTotal] = useState<number | null>(null);
  const [teamCursor, setTeamCursor] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [userTotal, setUserTotal] = useState<number | null>(null);
  const [userCursor, setUserCursor] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState<number | null>(null);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditActor, setAuditActor] = useState(() => params.get("actor") ?? "");
  const [auditAction, setAuditAction] = useState(() => params.get("action") ?? "");
  const [auditTarget, setAuditTarget] = useState(() => params.get("target") ?? "");
  const [auditFrom, setAuditFrom] = useState(() => params.get("from") ?? "");
  const [auditTo, setAuditTo] = useState(() => params.get("to") ?? "");
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [sectionErrors, setSectionErrors] = useState<SectionErrors>({});
  const [updatedAt, setUpdatedAt] = useState<SectionTimes>({});
  const [ticketStatus, setTicketStatus] = useState<SupportTicketStatus>(() => (isTicketStatus(params.get("ticketStatus")) ? params.get("ticketStatus") as SupportTicketStatus : "open"));
  const [unassignedOnly, setUnassignedOnly] = useState(() => params.get("unassigned") === "1");
  const [ticketQuery, setTicketQuery] = useState(() => params.get("tq") ?? "");
  const [ticketSearch, setTicketSearch] = useState(() => params.get("tq") ?? "");
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [ticketDetail, setTicketDetail] = useState<SupportTicketDetail | null>(null);
  const [draftStatus, setDraftStatus] = useState<SupportTicketStatus>("open");
  const [reply, setReply] = useState("");
  const [ticketTotal, setTicketTotal] = useState<number | null>(null);
  const [ticketCursor, setTicketCursor] = useState<string | null>(null);
  const [ticketReload, setTicketReload] = useState(0);
  const [panelReload, setPanelReload] = useState(0);
  const [selected, setSelected] = useState<AdminAccount | null>(null);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [status, setStatus] = useState<AccountStatus>(() => (isAccountStatus(params.get("userStatus")) ? params.get("userStatus") as AccountStatus : "all"));
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmRetryId, setConfirmRetryId] = useState<string | null>(null);
  const revision = useRef(0);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const usersAbort = useRef<AbortController | null>(null);
  const reportsAbort = useRef<AbortController | null>(null);
  const auditAbort = useRef<AbortController | null>(null);
  const usersGen = useRef(0);
  const reportsGen = useRef(0);
  const auditGen = useRef(0);
  const userTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticketTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef({
    reportStatus: "open" as "open" | "resolved",
    reportType: "all" as ReportTargetType | "all",
    query: "",
    status: "all" as AccountStatus,
    audit: {} as AuditQuery,
  });
  filtersRef.current = {
    reportStatus,
    reportType,
    query,
    status,
    audit: {
      actor: auditActor.trim() || undefined,
      action: auditAction.trim() || undefined,
      targetId: auditTarget.trim() || undefined,
      from: /^\d{4}-\d{2}-\d{2}$/.test(auditFrom.trim()) ? `${auditFrom.trim()}T00:00:00Z` : undefined,
      to: exclusiveEnd(auditTo.trim()),
    },
  };

  const can = (permission: string) => overview?.permissions.includes(permission) ?? false;
  const permissionKey = (overview?.permissions ?? []).join("\n");
  const fallback = t("Something went wrong");
  const mark = (key: keyof SectionTimes) => setUpdatedAt(current => ({ ...current, [key]: new Date().toISOString() }));

  const begin = (slot: "users" | "reports" | "audit") => {
    const abort = slot === "users" ? usersAbort : slot === "reports" ? reportsAbort : auditAbort;
    const gen = slot === "users" ? usersGen : slot === "reports" ? reportsGen : auditGen;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    return { signal: controller.signal, gen: ++gen.current };
  };

  const refreshOverview = useCallback(async () => {
    try {
      const summary = await api.adminOverview();
      if (summary?.queues && Array.isArray(summary.permissions)) setOverview(summary);
    } catch {
      // Keep the counts already on screen when the refresh itself fails.
    }
  }, []);

  const refreshAudit = useCallback(async () => {
    const request = begin("audit");
    try {
      const page = await api.adminAuditLog(filtersRef.current.audit, request.signal);
      if (request.gen !== auditGen.current) return;
      setAudit(page.rows);
      setAuditTotal(page.total);
      setAuditCursor(page.next_cursor);
      mark("audit");
      setSectionErrors(current => ({ ...current, audit: undefined }));
    } catch (cause) {
      if (isAbortError(cause) || request.gen !== auditGen.current) return;
      setSectionErrors(current => ({ ...current, audit: cause instanceof Error ? cause.message : "The audit log could not be loaded." }));
    }
  }, []);

  const load = useCallback(async () => {
    const current = ++revision.current;
    const filters = filtersRef.current;
    const reportRequest = begin("reports");
    const userRequest = begin("users");
    const auditRequest = begin("audit");
    setError("");
    try {
      const summary = await api.adminOverview();
      if (current !== revision.current) return;
      setOverview(summary);
      const checked = await api.adminHealth();
      if (current !== revision.current) return;
      setHealth(checked);
      const [reportResult, userResult, auditResult] = await Promise.allSettled([
        summary.permissions.includes("reports.read")
          ? api.adminReports(filters.reportStatus, { targetType: filters.reportType, signal: reportRequest.signal })
          : Promise.resolve({ rows: [] as ModerationReport[], total: 0, next_cursor: null }),
        api.adminUsers(filters.query, filters.status, undefined, userRequest.signal),
        summary.permissions.includes("audit.read")
          ? api.adminAuditLog(filters.audit, auditRequest.signal)
          : Promise.resolve({ rows: [] as AuditEntry[], total: 0, next_cursor: null }),
      ]);
      if (current !== revision.current) return;
      const nextErrors: SectionErrors = {};
      if (reportResult.status === "fulfilled" && reportRequest.gen === reportsGen.current) {
        setReports(reportResult.value.rows);
        setReportTotal(reportResult.value.total);
        setReportCursor(reportResult.value.next_cursor);
        mark("reports");
      } else if (reportResult.status === "rejected" && !isAbortError(reportResult.reason) && reportRequest.gen === reportsGen.current) {
        nextErrors.reports = messageFrom(reportResult.reason, t("Reports could not be loaded."));
      }
      if (userResult.status === "fulfilled" && userRequest.gen === usersGen.current) {
        setUsers(userResult.value.users);
        setUserTotal(userResult.value.total);
        setUserCursor(userResult.value.next_cursor);
        mark("users");
      } else if (userResult.status === "rejected" && !isAbortError(userResult.reason) && userRequest.gen === usersGen.current) {
        nextErrors.users = messageFrom(userResult.reason, t("Accounts could not be loaded."));
      }
      if (auditResult.status === "fulfilled" && auditRequest.gen === auditGen.current) {
        setAudit(auditResult.value.rows);
        setAuditTotal(auditResult.value.total);
        setAuditCursor(auditResult.value.next_cursor);
        mark("audit");
      } else if (auditResult.status === "rejected" && !isAbortError(auditResult.reason) && auditRequest.gen === auditGen.current) {
        nextErrors.audit = messageFrom(auditResult.reason, t("The audit log could not be loaded."));
      }
      setSectionErrors(previous => ({ ...previous, reports: nextErrors.reports, users: nextErrors.users, audit: nextErrors.audit }));
    } catch (cause) {
      if (current === revision.current && !isAbortError(cause)) setError(messageFrom(cause, fallback));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [fallback, t]);

  useEffect(() => {
    writeConsoleQuery({
      tab,
      reportStatus,
      reportType: reportType === "all" ? "" : reportType,
      coach: coachFilter,
      join: joinStatus,
      ticketStatus,
      unassigned: unassignedOnly ? "1" : "",
      userStatus: status,
      q: query,
      tq: ticketSearch,
      actor: auditActor,
      action: auditAction,
      target: auditTarget,
      from: auditFrom,
      to: auditTo,
    });
  }, [tab, reportStatus, reportType, coachFilter, joinStatus, ticketStatus, unassignedOnly, status, query, ticketSearch, auditActor, auditAction, auditTarget, auditFrom, auditTo]);

  useEffect(() => {
    if (!overview) return undefined;
    const controller = new AbortController();
    let cancel = false;
    const fail = (key: keyof SectionErrors) => (cause: unknown) => {
      if (cancel || isAbortError(cause)) return;
      setSectionErrors(current => ({ ...current, [key]: messageFrom(cause, fallback) }));
    };
    if (tab === "joins") {
      void api.adminMemberships(joinStatus, undefined, controller.signal).then(page => {
        if (cancel) return;
        setJoins(page.rows);
        setJoinTotal(page.total);
        setJoinCursor(page.next_cursor);
        mark("joins");
        setSectionErrors(current => ({ ...current, joins: undefined }));
      }).catch(fail("joins"));
    }
    if (tab === "communities") {
      void api.adminCommunities(undefined, controller.signal).then(page => {
        if (cancel) return;
        setCommunities(page.rows);
        setCommunityTotal(page.total);
        setCommunityCursor(page.next_cursor);
        mark("communities");
        setSectionErrors(current => ({ ...current, communities: undefined }));
      }).catch(fail("communities"));
    }
    if (tab === "team") {
      void api.adminUsers("", "staff", undefined, controller.signal).then(page => {
        if (cancel) return;
        setTeam(page.users);
        setTeamTotal(page.total);
        setTeamCursor(page.next_cursor);
        mark("team");
        setSectionErrors(current => ({ ...current, team: undefined }));
      }).catch(fail("team"));
    }
    if (tab === "coaches") {
      if (!overview.permissions.includes("coaches.review")) {
        setCoachDirectory([]);
        setCoachTotal(0);
        setCoachCursor(null);
        return () => { cancel = true; controller.abort(); };
      }
      void api.adminCoaches(coachFilter, undefined, controller.signal).then(page => {
        if (cancel) return;
        setCoachDirectory(page.rows);
        setCoachTotal(page.total);
        setCoachCursor(page.next_cursor);
        mark("coaches");
        setSectionErrors(current => ({ ...current, coaches: undefined }));
      }).catch(cause => {
        if (cancel || isAbortError(cause)) return;
        setCoachDirectory([]);
        setSectionErrors(current => ({ ...current, coaches: messageFrom(cause, fallback) }));
      });
    }
    if (tab === "support") {
      if (!overview.permissions.includes("tickets.read")) {
        setTickets([]);
        return () => { cancel = true; controller.abort(); };
      }
      setTickets(null);
      void api.adminTickets(ticketStatus, ticketSearch, { unassigned: unassignedOnly, signal: controller.signal }).then(page => {
        if (cancel) return;
        setTickets(page.tickets);
        setTicketTotal(typeof page.total === "number" ? page.total : null);
        setTicketCursor(page.next_cursor ?? null);
        mark("support");
        setSectionErrors(current => ({ ...current, support: undefined }));
      }).catch(cause => {
        if (cancel || isAbortError(cause)) return;
        setTickets([]);
        setSectionErrors(current => ({ ...current, support: messageFrom(cause, fallback) }));
      });
    }
    return () => { cancel = true; controller.abort(); };
    // `overview` is read for permissions. Depending on the object refetches
    // this tab when a mutation updates a queue count and puts the removed row back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, permissionKey, joinStatus, coachFilter, ticketStatus, ticketSearch, ticketReload, panelReload, unassignedOnly, fallback]);

  useFocusEffect(useCallback(() => {
    busy.current = false;
    setWorking(false);
    setLoading(true);
    void load();
    return () => { revision.current += 1; };
  }, [load]));

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => () => {
    if (userTimer.current) clearTimeout(userTimer.current);
    if (ticketTimer.current) clearTimeout(ticketTimer.current);
    if (auditTimer.current) clearTimeout(auditTimer.current);
  }, []);

  const act = async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError("");
    try { await action(); }
    catch (cause) {
      if (!isAbortError(cause)) setError(messageFrom(cause, fallback));
    }
    finally { busy.current = false; setWorking(false); }
  };

  const fetchUsers = async (nextQuery: string, next: AccountStatus, cursor?: string) => {
    const request = begin("users");
    const page = await api.adminUsers(nextQuery, next, cursor, request.signal);
    if (request.gen !== usersGen.current) return;
    setStatus(next);
    if (cursor) {
      setUsers(current => {
        const seen = new Set(current.map(row => row.id));
        return [...current, ...page.users.filter(row => !seen.has(row.id))];
      });
    } else setUsers(page.users);
    setUserTotal(page.total);
    setUserCursor(page.next_cursor);
    mark("users");
    setSectionErrors(current => ({ ...current, users: undefined }));
  };

  const search = (next: AccountStatus = status) => act(async () => {
    setStatus(next);
    await fetchUsers(query, next);
  });
  const onUserQuery = (value: string) => {
    setQuery(value);
    if (userTimer.current) clearTimeout(userTimer.current);
    userTimer.current = setTimeout(() => {
      void fetchUsers(value, status).catch(cause => {
        if (!isAbortError(cause)) setSectionErrors(current => ({ ...current, users: messageFrom(cause, fallback) }));
      });
    }, 300);
  };

  const loadReports = (next: "open" | "resolved", type: ReportTargetType | "all" = reportType) => act(async () => {
    setReportStatus(next);
    setReportType(type);
    const request = begin("reports");
    const page = await api.adminReports(next, { targetType: type, signal: request.signal });
    if (request.gen !== reportsGen.current) return;
    setReports(page.rows);
    setReportTotal(page.total);
    setReportCursor(page.next_cursor);
    mark("reports");
    setSectionErrors(current => ({ ...current, reports: undefined }));
  });
  const moreReports = () => act(async () => {
    if (!reportCursor) return;
    const page = await api.adminReports(reportStatus, { cursor: reportCursor, targetType: reportType });
    setReports(current => {
      const seen = new Set(current.map(row => row.id));
      return [...current, ...page.rows.filter(row => !seen.has(row.id))];
    });
    setReportTotal(page.total);
    setReportCursor(page.next_cursor);
  });
  const moreUsers = () => act(async () => { if (userCursor) await fetchUsers(query, status, userCursor); });
  const searchAudit = () => act(async () => { await refreshAudit(); });
  const onAuditField = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (auditTimer.current) clearTimeout(auditTimer.current);
    auditTimer.current = setTimeout(() => { void refreshAudit(); }, 300);
  };
  const moreJoins = () => act(async () => {
    if (!joinCursor) return;
    const page = await api.adminMemberships(joinStatus, joinCursor);
    setJoins(current => {
      const seen = new Set(current.map(row => row.id));
      return [...current, ...page.rows.filter(row => !seen.has(row.id))];
    });
    setJoinTotal(page.total);
    setJoinCursor(page.next_cursor);
  });
  const moreCommunities = () => act(async () => {
    if (!communityCursor) return;
    const page = await api.adminCommunities(communityCursor);
    setCommunities(current => {
      const seen = new Set(current.map(row => row.id));
      return [...current, ...page.rows.filter(row => !seen.has(row.id))];
    });
    setCommunityTotal(page.total);
    setCommunityCursor(page.next_cursor);
  });
  const moreTeam = () => act(async () => {
    if (!teamCursor) return;
    const page = await api.adminUsers("", "staff", teamCursor);
    setTeam(current => {
      const seen = new Set(current.map(row => row.id));
      return [...current, ...page.users.filter(row => !seen.has(row.id))];
    });
    setTeamTotal(page.total);
    setTeamCursor(page.next_cursor);
  });
  const moreTickets = () => act(async () => {
    if (!ticketCursor) return;
    const page = await api.adminTickets(ticketStatus, ticketSearch, { unassigned: unassignedOnly, cursor: ticketCursor });
    setTickets(current => {
      const seen = new Set((current ?? []).map(row => row.id));
      return [...(current ?? []), ...page.tickets.filter(row => !seen.has(row.id))];
    });
    setTicketTotal(typeof page.total === "number" ? page.total : null);
    setTicketCursor(page.next_cursor ?? null);
  });
  const moreCoaches = () => act(async () => {
    if (!coachCursor) return;
    const page = await api.adminCoaches(coachFilter, coachCursor);
    setCoachDirectory(current => {
      const seen = new Set((current ?? []).map(row => row.application_id || row.user_id));
      return [...(current ?? []), ...page.rows.filter(row => !seen.has(row.application_id || row.user_id))];
    });
    setCoachTotal(page.total);
    setCoachCursor(page.next_cursor);
  });
  const moreAudit = () => act(async () => {
    if (!auditCursor) return;
    const page = await api.adminAuditLog({ ...filtersRef.current.audit, cursor: auditCursor });
    setAudit(current => {
      const seen = new Set(current.map(row => row.id));
      return [...current, ...page.rows.filter(row => !seen.has(row.id))];
    });
    setAuditTotal(page.total);
    setAuditCursor(page.next_cursor);
  });
  const selectTab = (next: Tab) => {
    if (tab === "support" && next !== "support") setTicketDetail(null);
    setTabState(next);
  };
  const openUser = (id: string) => act(async () => {
    setTabState("users");
    setSelected(await api.adminUser(id));
    setReason("");
  });
  const decideJoin = (row: AdminMembership, decision: "active" | "rejected") => act(async () => {
    await api.adminReviewMembership(row.id, decision, reason.trim());
    setJoins(rows => rows.filter(item => item.id !== row.id));
    setJoinTotal(current => (current == null ? current : Math.max(0, current - 1)));
    setReason("");
    if (joinStatus === "pending") {
      setOverview(current => current ? { ...current, queues: { ...current.queues, pending_memberships: Math.max(0, current.queues.pending_memberships - 1) } } : current);
    }
    await refreshOverview();
    await refreshAudit();
  });
  const resolve = (report: ModerationReport, resolution: string) => act(async () => {
    const reviewed = await api.adminReviewReport(report.id, resolution, reason.trim());
    setReason("");
    if (reviewed.resolution_status === "partial") {
      setReports(rows => rows.map(row => row.id === report.id ? { ...row, ...reviewed, reporter: row.reporter, reported_user: row.reported_user } : row));
      setSectionErrors(current => ({ ...current, reports: t("The decision was saved. The side effect did not finish. Retry it on this report.") }));
    } else {
      setReports(rows => rows.filter(row => row.id !== report.id));
      if (reportStatus === "open") {
        setOverview(current => current ? { ...current, queues: { ...current.queues, open_reports: Math.max(0, current.queues.open_reports - 1) } } : current);
        setReportTotal(current => (current == null ? current : Math.max(0, current - 1)));
      }
    }
    await refreshOverview();
    await refreshAudit();
  });
  const retryReport = (report: ModerationReport) => act(async () => {
    const reviewed = await api.adminRetryReport(report.id);
    if (reviewed.resolution_status === "partial") {
      setReports(rows => rows.map(row => row.id === report.id ? { ...row, ...reviewed, reporter: row.reporter, reported_user: row.reported_user } : row));
      setSectionErrors(current => ({ ...current, reports: t("The decision was saved. The side effect did not finish. Retry it on this report.") }));
      await refreshOverview();
      await refreshAudit();
      return;
    }
    setConfirmRetryId(null);
    setReports(rows => rows.filter(row => row.id !== report.id));
    setSectionErrors(current => ({ ...current, reports: undefined }));
    await refreshOverview();
    await refreshAudit();
  });
  const reviewApplication = (application: CoachApplicationReview, next: "approved" | "rejected") => act(async () => {
    await api.reviewCoachApplication(application.id, next, reason.trim() || undefined);
    setCoachDirectory(rows => rows ? rows.filter(row => row.application_id !== application.id) : rows);
    setCoachTotal(current => (current == null ? current : Math.max(0, current - 1)));
    setReason("");
    if (coachFilter === "pending") {
      setOverview(current => current ? { ...current, queues: { ...current.queues, pending_coach_applications: Math.max(0, current.queues.pending_coach_applications - 1) } } : current);
    }
    await refreshOverview();
    await refreshAudit();
  });
  const addNote = (account: AdminAccount) => act(async () => {
    await api.adminAddNote(account.id, note.trim());
    setSelected(await api.adminUser(account.id));
    setNote("");
    await refreshAudit();
  });
  const suspend = (account: AdminAccount) => act(async () => {
    const updated = account.suspended_at
      ? await api.adminReinstate(account.id, reason.trim())
      : await api.adminSuspend(account.id, reason.trim());
    setSelected(await api.adminUser(updated.id));
    setReason("");
    setUsers(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
    await refreshOverview();
    await refreshAudit();
  });
  const setRole = (account: AdminAccount, role: StaffRole | null) => act(async () => {
    const updated = await api.adminSetStaffRole(account.id, role, reason.trim());
    setSelected(await api.adminUser(updated.id));
    setReason("");
    setUsers(rows => rows.map(row => row.id === updated.id ? { ...row, staff_role: updated.staff_role } : row));
    setTeam(rows => role ? rows.map(row => row.id === updated.id ? { ...row, staff_role: updated.staff_role } : row) : rows.filter(row => row.id !== updated.id));
    if (!role) setTeamTotal(current => (current == null ? current : Math.max(0, current - 1)));
    await refreshOverview();
    await refreshAudit();
  });
  const openTicket = (id: string) => act(async () => {
    const detail = await api.adminTicket(id);
    setTicketDetail(detail);
    setDraftStatus(detail.status);
    setReply("");
  });
  const rememberTicket = (detail: SupportTicketDetail) => {
    setTicketDetail(detail);
    setDraftStatus(detail.status);
    setTickets(rows => rows ? rows.map(row => row.id === detail.id ? { ...row, status: detail.status, updated_at: detail.updated_at, assignee_id: detail.assignee_id, user: detail.user, assignee: detail.assignee } : row) : rows);
  };
  const saveTicketStatus = () => act(async () => {
    if (!ticketDetail || draftStatus === ticketDetail.status) return;
    await api.adminUpdateTicket(ticketDetail.id, { status: draftStatus });
    rememberTicket(await api.adminTicket(ticketDetail.id));
    await refreshOverview();
    await refreshAudit();
  });
  const sendReply = () => act(async () => {
    if (!ticketDetail) return;
    const id = ticketDetail.id;
    await api.adminReplyTicket(id, reply.trim());
    track("ticket_replied", { ticket_id: id });
    setReply("");
    let statusError = "";
    try {
      await api.adminUpdateTicket(id, { status: "pending" });
    } catch (cause) {
      statusError = messageFrom(cause, fallback);
    }
    rememberTicket(await api.adminTicket(id));
    await refreshOverview();
    await refreshAudit();
    if (statusError) throw new Error(statusError);
  });
  const onTicketQuery = (value: string) => {
    setTicketQuery(value);
    if (ticketTimer.current) clearTimeout(ticketTimer.current);
    ticketTimer.current = setTimeout(() => setTicketSearch(value.trim()), 300);
  };
  const submitTicketSearch = () => {
    if (ticketTimer.current) clearTimeout(ticketTimer.current);
    setTicketSearch(ticketQuery.trim());
  };

  return {
    user, logout, t, formatDate, formatNumber,
    tab, selectTab, coachFilter,
    setCoachFilter: (next: CoachFilter) => { setCoachDirectory(null); setCoachFilter(next); },
    coachDirectory, coachTotal, coachCursor,
    note, setNote, overview, reports, reportTotal, reportCursor, reportStatus, reportType,
    joins, joinTotal, joinCursor, joinStatus, setJoinStatus,
    communities, communityTotal, communityCursor, team, teamTotal, teamCursor,
    users, userTotal, userCursor, audit, auditTotal, auditCursor,
    auditActor, setAuditActor: onAuditField(setAuditActor),
    auditAction, setAuditAction: onAuditField(setAuditAction),
    auditTarget, setAuditTarget: onAuditField(setAuditTarget),
    auditFrom, setAuditFrom: onAuditField(setAuditFrom),
    auditTo, setAuditTo: onAuditField(setAuditTo),
    health, sectionErrors, updatedAt, ticketStatus, setTicketStatus, unassignedOnly, setUnassignedOnly,
    ticketQuery, onTicketQuery, submitTicketSearch, tickets, ticketDetail, setTicketDetail,
    draftStatus, setDraftStatus, reply, setReply, ticketTotal, ticketCursor,
    selected, query, onUserQuery, status, reason, setReason, loading, error, working, can,
    confirmRetryId, setConfirmRetryId,
    search, loadReports, moreReports, moreUsers, searchAudit, moreJoins, moreCommunities, moreTeam,
    moreTickets, moreCoaches, moreAudit, openUser, decideJoin, resolve, retryReport, reviewApplication,
    addNote, suspend, setRole, openTicket, saveTicketStatus, sendReply,
    retrySection: (key: keyof SectionErrors) => {
      if (key === "reports") void loadReports(reportStatus, reportType);
      else if (key === "users") void search();
      else if (key === "audit") void searchAudit();
      else setPanelReload(value => value + 1);
    },
    reloadVisible: () => {
      setTicketReload(value => value + 1);
      void load();
    },
  };
}

export type AdminConsoleModel = ReturnType<typeof useAdminConsole>;
