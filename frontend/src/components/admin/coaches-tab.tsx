import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Affordance } from "@/src/press-affordance";
import type { CoachApplicationReview } from "@/src/api";
import { colors } from "@/src/theme";
import type { CoachFilter } from "./admin-labels";
import { ConfirmAction } from "./confirm-action";
import { consoleStyles as styles } from "./console-styles";
import { DetailPanel } from "./detail-panel";
import { FilterBar } from "./filter-bar";
import { QueueList } from "./queue-list";
import type { AdminConsoleModel } from "./use-admin-console";

const FILTERS: readonly (readonly [CoachFilter, string])[] = [
  ["pending", "Waiting list"],
  ["approved", "Approved coaches"],
  ["suspended", "Banned coaches"],
  ["rejected", "Rejected coaches"],
];

function emptyCopy(filter: CoachFilter): string {
  switch (filter) {
    case "pending":
      return "No coach applications waiting.";
    case "approved":
      return "No approved coaches.";
    case "suspended":
      return "No banned coaches.";
    case "rejected":
      return "No rejected coaches.";
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

function tagCopy(filter: CoachFilter): string {
  switch (filter) {
    case "pending":
      return "COACH APPLICATION";
    case "approved":
      return "Approved coaches";
    case "suspended":
      return "Banned coaches";
    case "rejected":
      return "Rejected coaches";
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

export function CoachesTab({ model }: { model: AdminConsoleModel }) {
  const { t, formatDate, coachFilter, setCoachFilter, coachDirectory, coachTotal, coachCursor, sectionErrors, updatedAt, reason, setReason, working, can, moreCoaches, reviewApplication, pending, setPending, confirmPending, openUser, retrySection } = model;
  return (
    <>
      <FilterBar label={t("Coach queue")}>
        {FILTERS.map(([item, label]) => (
          <Affordance key={item} accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={{ selected: coachFilter === item }} onPress={() => { setCoachFilter(item); }} style={[styles.chip, coachFilter === item && styles.chipActive]}>
            <Text style={[styles.chipText, coachFilter === item && styles.chipTextActive]}>{t(label)}</Text>
          </Affordance>
        ))}
      </FilterBar>
      {coachFilter === "suspended" ? <Text style={styles.hint}>{t("A banned coach has a suspended account. Open the account to suspend or reinstate.")}</Text> : null}
      <QueueList
        t={t}
        formatDate={formatDate}
        loading={coachDirectory === null && !sectionErrors.coaches}
        error={sectionErrors.coaches}
        onRetry={() => retrySection("coaches")}
        retryLabel={t("Retry coaches")}
        updatedAt={updatedAt.coaches}
        empty={coachDirectory && coachDirectory.length === 0 && !sectionErrors.coaches ? t(emptyCopy(coachFilter)) : null}
        loaded={coachDirectory?.length ?? 0}
        total={coachTotal}
        nextCursor={coachCursor}
        onMore={coachCursor ? () => void moreCoaches() : undefined}
        queueLabel={t("coaches")}
        footerLoading={working}
      >
        {coachDirectory && coachFilter === "pending" && coachDirectory.length > 0 ? <TextInput value={reason} onChangeText={setReason} maxLength={500} accessibilityLabel={t("Review note (sent to the applicant)")} placeholder={t("Review note (sent to the applicant)")} placeholderTextColor={colors.textDim} style={styles.input} /> : null}
        {(coachDirectory || []).map(coach => (
          <DetailPanel key={coach.application_id || coach.user_id} testID={`application-${coach.application_id || coach.user_id}`}>
            <View style={styles.cardHead}>
              <Text style={styles.tag}>{t(tagCopy(coachFilter))}</Text>
              {coach.created_at ? <Text style={styles.time}>{formatDate(coach.created_at, { day: "numeric", month: "short" })}</Text> : null}
            </View>
            <Text style={styles.name}>{coach.full_name || coach.email || t("Unknown")}</Text>
            <Text style={styles.meta}>{coach.email}</Text>
            {coach.suspended_at ? <Text style={styles.suspendedNote}>{t("SUSPENDED")}</Text> : null}
            {coach.bio ? <Text style={styles.snapshot}>{coach.bio}</Text> : null}
            {coach.specialties?.length ? <Text style={styles.meta}>{t("SPECIALTIES")}: {coach.specialties.join(", ")}</Text> : null}
            {coach.credentials?.length ? <Text style={styles.meta}>{t("CREDENTIALS · ONE PER LINE")}: {coach.credentials.join(", ")}</Text> : null}
            {coach.review_note ? <Text style={styles.meta}>{coach.review_note}</Text> : null}
            {!coach.application_id ? <Text style={styles.hint}>{t("No application on file.")}</Text> : null}
            {coachFilter === "pending" && coach.application_id ? (can("coaches.review") ? <View style={styles.actions}>
              <Affordance accessibilityRole="button" accessibilityLabel={t("Reject application {id}", { id: coach.application_id })} testID={`reject-application-${coach.application_id}`} disabled={working} onPress={() => setPending({ kind: "coach-reject", applicationId: coach.application_id!, userId: coach.user_id })} style={[styles.action, working && styles.disabled]}>
                <Ionicons name="close" size={15} color={colors.error} />
                <Text style={styles.actionText}>{t("Reject")}</Text>
              </Affordance>
              <Affordance accessibilityRole="button" accessibilityLabel={t("Approve application {id}", { id: coach.application_id })} testID={`approve-application-${coach.application_id}`} disabled={working} onPress={() => void reviewApplication({ id: coach.application_id!, user_id: coach.user_id } as CoachApplicationReview, "approved")} style={[styles.action, working && styles.disabled]}>
                <Ionicons name="checkmark" size={15} color={colors.text} />
                <Text style={styles.actionText}>{t("Approve")}</Text>
              </Affordance>
            </View> : <Text style={styles.hint}>{t("Read-only: reviewing coaches needs the admin role.")}</Text>) : null}
            {pending?.kind === "coach-reject" && pending.applicationId === coach.application_id ? (
              <ConfirmAction
                testID={`confirm-reject-application-${coach.application_id}`}
                title={t("Reject this application")}
                body={t("The applicant is told the application was not approved. A suspended coach is changed from the account, which asks before it suspends.")}
                confirmLabel={t("Reject")}
                onConfirm={next => confirmPending(next || reason.trim())}
                onCancel={() => setPending(null)}
                busy={working}
                t={t}
              />
            ) : null}
            <Affordance accessibilityRole="button" accessibilityLabel={t("Open account")} onPress={() => void openUser(coach.user_id)}><Text style={styles.link}>{t("Open account")}</Text></Affordance>
          </DetailPanel>
        ))}
      </QueueList>
    </>
  );
}
