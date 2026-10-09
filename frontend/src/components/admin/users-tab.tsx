import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import type { StaffRole } from "@/src/api";
import { colors } from "@/src/theme";
import type { AccountStatus } from "./admin-labels";
import { ConfirmAction } from "./confirm-action";
import { consoleStyles as styles } from "./console-styles";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { FilterChip } from "./filter-chip";
import { StatusBadge } from "./status-badge";
import { QueueList } from "./queue-list";
import { QueueRow } from "./queue-row";
import type { AdminConsoleModel } from "./use-admin-console";

const STATUSES: AccountStatus[] = ["all", "active", "suspended", "staff"];

export function UsersTab({ model }: { model: AdminConsoleModel }) {
  const { t, formatDate, formatNumber, users, userTotal, userCursor, query, onUserQuery, status, search, moreUsers, selected, reason, setReason, note, setNote, working, can, sectionErrors, updatedAt, loading, openUser, pending, setPending, confirmPending, addNote, retrySection } = model;
  const suspendDisabled = working || reason.trim().length < (selected?.suspended_at ? 5 : 10);
  return (
    <>
      <View style={styles.searchRow}>
        <TextInput value={query} onChangeText={onUserQuery} onSubmitEditing={() => void search()} maxLength={80} accessibilityLabel={t("Search by name, email or ID")} placeholder={t("Search by name, email or ID")} placeholderTextColor={colors.textDim} style={[styles.input, { flex: 1, marginBottom: 0 }]} testID="admin-user-search" />
        <Affordance accessibilityRole="button" accessibilityLabel={t("Search")} disabled={working} onPress={() => void search()} style={styles.searchBtn}><Ionicons name="search" size={18} color={colors.text} /></Affordance>
      </View>
      <FilterBar label={t("Account status")}>
        {STATUSES.map(item => (
          <FilterChip key={item} label={t(item.toUpperCase())} selected={status === item} onPress={() => { void search(item); }} />
        ))}
      </FilterBar>
      <QueueList
        t={t}
        formatDate={formatDate}
        error={sectionErrors.users}
        onRetry={() => retrySection("users")}
        retryLabel={t("Retry accounts")}
        updatedAt={updatedAt.users}
        empty={!loading && users.length === 0 ? t("Nothing in this list.") : null}
        loaded={users.length}
        total={userTotal}
        nextCursor={userCursor}
        onMore={() => void moreUsers()}
        queueLabel={t("accounts")}
        footerLoading={working}
      >
        {users.map(account => (
          <QueueRow
            key={account.id}
            label={account.full_name || account.email}
            testID={`admin-user-${account.id}`}
            onPress={() => void openUser(account.id)}
            trailing={
              <>
                {account.staff_role ? <StatusBadge tone="neutral" label={t(account.staff_role.toUpperCase())} /> : null}
                {account.gym_owner ? <StatusBadge tone="info" label={t("GYM OWNER")} testID={`gym-owner-${account.id}`} /> : null}
                {account.suspended_at ? <StatusBadge tone="danger" label={t("SUSPENDED")} /> : null}
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </>
            }
          >
            <Text style={styles.name}>{account.full_name || account.email}</Text>
            <Text style={styles.meta}>{account.email}</Text>
          </QueueRow>
        ))}
      </QueueList>
      {selected ? <DetailPanel testID="admin-user-detail" label={selected.full_name || selected.email}>
        <Text style={styles.section}>{selected.full_name || selected.email}</Text>
        <Text style={styles.meta}>{selected.email} · {t(selected.role.toUpperCase())} · {t("Joined")} {formatDate(selected.created_at, { dateStyle: "medium" })}</Text>
        {selected.stats ? <View style={styles.grid}>
          {([["workouts", "Workouts"], ["posts", "Posts"], ["communities", "Communities"], ["reports_against", "Reports"]] as const).map(([key, label]) => (
            <View key={key} style={styles.metric}><Text style={styles.metricValue}>{formatNumber(selected.stats![key])}</Text><Text style={styles.metricLabel}>{t(label)}</Text></View>
          ))}
        </View> : null}
        {selected.suspended_at ? <Text style={styles.suspendedNote}>{t("Suspended:")} {selected.suspension_reason}</Text> : null}
        <TextInput value={reason} onChangeText={setReason} maxLength={500} accessibilityLabel={t("Reason (required, saved to the audit log)")} placeholder={t("Reason (required, saved to the audit log)")} placeholderTextColor={colors.textDim} style={styles.input} testID="admin-reason" />
        <View style={styles.actions}>
          {can("users.suspend") ? <Affordance accessibilityRole="button" accessibilityLabel={t(selected.suspended_at ? "Reinstate {name}" : "Suspend {name}", { name: selected.full_name || selected.email })} testID="admin-suspend" disabled={suspendDisabled} onPress={() => setPending({ kind: "suspend", account: selected })} style={[styles.action, suspendDisabled && styles.disabled]}>
            <Ionicons name={selected.suspended_at ? "lock-open-outline" : "lock-closed-outline"} size={15} color={selected.suspended_at ? colors.success : colors.error} />
            <Text style={styles.actionText}>{t(selected.suspended_at ? "REINSTATE" : "SUSPEND")}</Text>
          </Affordance> : null}
          {can("staff.manage") ? ([null, "support", "moderator", "admin"] as (StaffRole | null)[]).map(role => (
            <Affordance key={role ?? "none"} accessibilityRole="button" accessibilityLabel={t("Set staff role {role}", { role: t((role ?? "no staff").toUpperCase()) })} testID={`admin-role-${role ?? "none"}`} disabled={working || reason.trim().length < 5 || selected.staff_role === role} onPress={() => setPending({ kind: "role", account: selected, role })} style={[styles.action, (working || reason.trim().length < 5 || selected.staff_role === role) && styles.disabled]}>
              <Text style={styles.actionText}>{t((role ?? "no staff").toUpperCase())}</Text>
            </Affordance>
          )) : null}
        </View>
        {pending?.kind === "suspend" && pending.account.id === selected.id ? (
          <ConfirmAction
            testID={selected.suspended_at ? "confirm-reinstate" : "confirm-suspend"}
            title={t(selected.suspended_at ? "Reinstate this account" : "Suspend this account")}
            body={t(selected.suspended_at ? "The account can sign in again." : "This blocks sign-in until the account is reinstated.")}
            confirmLabel={t(selected.suspended_at ? "REINSTATE" : "SUSPEND")}
            reason={reason}
            minReason={selected.suspended_at ? 5 : 10}
            onConfirm={next => confirmPending(next)}
            onCancel={() => setPending(null)}
            busy={working}
            t={t}
          />
        ) : null}
        {pending?.kind === "role" && pending.account.id === selected.id ? (
          <ConfirmAction
            testID={`confirm-role-${pending.role ?? "none"}`}
            title={t("Change the staff role")}
            body={t("This changes what the account can do in the console.")}
            confirmLabel={t("CHANGE ROLE")}
            reason={reason}
            minReason={5}
            onConfirm={next => confirmPending(next)}
            onCancel={() => setPending(null)}
            busy={working}
            t={t}
          />
        ) : null}
        <Text style={styles.section}>{t("STAFF NOTES")}</Text>
        {selected.notes?.length
          ? selected.notes.map(item => <View key={item.id} style={styles.note}><Text style={styles.meta}>{item.author_email} · {formatDate(item.created_at, { dateStyle: "short" })}</Text><Text style={styles.noteText}>{item.note}</Text></View>)
          : <Text style={styles.hint}>{t("No notes on this account yet.")}</Text>}
        <TextInput value={note} onChangeText={setNote} maxLength={1000} accessibilityLabel={t("Add a note for the team")} placeholder={t("Add a note for the team")} placeholderTextColor={colors.textDim} style={styles.input} testID="admin-note" />
        <Affordance accessibilityRole="button" accessibilityLabel={t("Save note")} testID="admin-add-note" disabled={working || note.trim().length < 3} onPress={() => void addNote(selected)} style={[styles.action, (working || note.trim().length < 3) && styles.disabled]}>
          <Ionicons name="create-outline" size={15} color={colors.text} />
          <Text style={styles.actionText}>{t("Save note")}</Text>
        </Affordance>
      </DetailPanel> : null}
    </>
  );
}
