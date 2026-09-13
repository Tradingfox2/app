import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, ChannelOverwrite, CommunityChannel, CommunityRole, Membership } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { PERMISSION_LIST, can, toggle as togglePermission } from "@/src/permissions";

/** inherit -> allow -> deny -> inherit */
type Tri = "inherit" | "allow" | "deny";

export default function ManageCommunity() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { t } = useI18n();
  const [members, setMembers] = useState<Membership[]>([]); const [channels, setChannels] = useState<CommunityChannel[]>([]); const [channelName, setChannelName] = useState(""); const [error, setError] = useState("");
  const [roles, setRoles] = useState<CommunityRole[]>([]); const [roleName, setRoleName] = useState("");
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const [overwriteRole, setOverwriteRole] = useState<string | null>(null);
  const [openMember, setOpenMember] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const load = useCallback(async () => {
    if (!id) return;
    const current = generation.current;
    try {
      const [memberRows, channelRows, roleRows] = await Promise.all([
        api.communityMembers(id), api.communityChannels(id), api.communityRoles(id),
      ]);
      if (current !== generation.current) return;
      setMembers(memberRows); setChannels(channelRows); setRoles(roleRows); setError("");
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : t("Could not load management tools"));
    } finally { if (current === generation.current) setLoading(false); }
  }, [id, t]);
  useFocusEffect(useCallback(() => {
    generation.current += 1; busy.current = false; setReviewing(false);
    setMembers([]); setChannels([]); setRoles([]); setLoading(true); setError("");
    setOpenRole(null); setOpenChannel(null); setOverwriteRole(null); setOpenMember(null); void load();
    return () => { generation.current += 1; };
  }, [load]));
  // Every mutation is single-flight and re-reads from the server on success, so
  // a permission change can never be shown as applied when it was not.
  const run = async (action: () => Promise<void>, failure = "Something went wrong") => {
    if (busy.current) return;
    const current = generation.current;
    busy.current = true; setReviewing(true); setError("");
    try { await action(); }
    catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : t(failure)); }
    finally { if (current === generation.current) { busy.current = false; setReviewing(false); } }
  };
  const review = (memberId: string, status: "active" | "rejected") => run(async () => {
    if (!id) return;
    await api.reviewCommunityMember(id, memberId, status); await load();
  });
  const addChannel = () => run(async () => {
    if (!id || channelName.trim().length < 2) return;
    await api.createCommunityChannel(id, channelName.trim()); setChannelName(""); await load();
  }, "Could not create channel");
  const publishChannel = (channel: CommunityChannel, value: boolean) => run(async () => {
    const updated = await api.updateChannelRanking(channel.id, value);
    setChannels(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  });
  const addRole = () => run(async () => {
    if (!id || roleName.trim().length < 2) return;
    await api.createRole(id, { name: roleName.trim() }); setRoleName(""); await load();
  }, "Could not create role");
  const removeRole = (role: CommunityRole) => run(async () => {
    await api.deleteRole(role.id);
    if (openRole === role.id) setOpenRole(null);
    if (overwriteRole === role.id) setOverwriteRole(null);
    await load();
  }, "Could not delete role");
  const flipPermission = (role: CommunityRole, bit: number) => run(async () => {
    const updated = await api.updateRole(role.id, { permissions: togglePermission(role.permissions, bit) });
    setRoles(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }, "Could not update role");
  const cycleOverwrite = (channel: CommunityChannel, roleId: string, bit: number) => run(async () => {
    const existing = channel.overwrites ?? [];
    const current = existing.find(row => row.role_id === roleId) ?? { role_id: roleId, allow: 0, deny: 0 };
    const state: Tri = can(current.allow, bit) ? "allow" : can(current.deny, bit) ? "deny" : "inherit";
    const next: ChannelOverwrite =
      state === "inherit" ? { ...current, allow: current.allow | bit, deny: current.deny & ~bit }
      : state === "allow" ? { ...current, allow: current.allow & ~bit, deny: current.deny | bit }
      : { ...current, allow: current.allow & ~bit, deny: current.deny & ~bit };
    const overwrites = [...existing.filter(row => row.role_id !== roleId), next]
      .filter(row => row.allow !== 0 || row.deny !== 0);  // drop rows that say nothing
    const updated = await api.setChannelOverwrites(channel.id, overwrites);
    setChannels(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }, "Could not update channel permissions");
  const flipMemberRole = (member: Membership, roleId: string) => run(async () => {
    if (!id) return;
    const currentRoles = member.role_ids ?? [];
    const nextRoles = currentRoles.includes(roleId)
      ? currentRoles.filter(row => row !== roleId)
      : [...currentRoles, roleId];
    await api.assignMemberRoles(id, member.id, nextRoles); await load();
  }, "Could not update member roles");

  const pending = members.filter(member => member.status === "pending");
  const active = members.filter(member => member.status === "active");
  const disabled = reviewing || loading;
  const triFor = (channel: CommunityChannel, roleId: string, bit: number): Tri => {
    const row = (channel.overwrites ?? []).find(entry => entry.role_id === roleId);
    if (!row) return "inherit";
    return can(row.allow, bit) ? "allow" : can(row.deny, bit) ? "deny" : "inherit";
  };

  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("MANAGE COMMUNITY")}</Text></View><ScrollView contentContainerStyle={styles.scroll}>
    {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" disabled={reviewing} onPress={() => void load()} style={styles.icon}><Text style={styles.active}>{t("Retry")}</Text></Pressable></View> : null}
    {loading || reviewing ? <ActivityIndicator color={colors.brand} /> : null}

    <Text style={styles.section}>{t("JOIN REQUESTS")}</Text>{pending.length ? pending.map(member => <View key={member.id} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.name}>{member.user?.full_name || t("Member")}</Text><Text style={styles.meta}>{t("Awaiting review")}</Text></View><Pressable accessibilityRole="button" disabled={reviewing} accessibilityLabel={t("Reject")} onPress={() => void review(member.id, "rejected")} style={[styles.icon, { opacity: reviewing ? 0.4 : 1 }]}><Ionicons name="close" size={20} color={colors.error} /></Pressable><Pressable accessibilityRole="button" disabled={reviewing} accessibilityLabel={t("Approve")} onPress={() => void review(member.id, "active")} style={[styles.approve, { opacity: reviewing ? 0.4 : 1 }]}><Ionicons name="checkmark" size={20} color={colors.brandOn} /></Pressable></View>) : !loading && !error ? <Text style={styles.empty}>{t("No pending requests")}</Text> : null}

    <Text style={styles.section}>{t("ROLES")}</Text>
    <Text style={styles.meta}>{t("Roles grant baseline powers. Channels can override them below.")}</Text>
    {roles.map(role => <View key={role.id}>
      <Pressable accessibilityRole="button" testID={`role-${role.id}`} onPress={() => setOpenRole(openRole === role.id ? null : role.id)} style={styles.row}>
        <View style={[styles.swatch, { backgroundColor: role.color }]} />
        <View style={{ flex: 1 }}><Text style={styles.name}>{role.name}</Text><Text style={styles.meta}>{role.is_default ? t("Applies to everyone") : `${t("Rank")} ${role.rank}`}</Text></View>
        <Ionicons name={openRole === role.id ? "chevron-up" : "chevron-down"} size={16} color={colors.textDim} />
      </Pressable>
      {openRole === role.id ? <View style={styles.panel} testID={`role-panel-${role.id}`}>
        {PERMISSION_LIST.map(entry => <Pressable key={entry.key} accessibilityRole="checkbox" accessibilityState={{ checked: can(role.permissions, entry.bit) }} testID={`role-${role.id}-${entry.key}`} disabled={disabled} onPress={() => void flipPermission(role, entry.bit)} style={styles.checkRow}>
          <Ionicons name={can(role.permissions, entry.bit) ? "checkbox" : "square-outline"} size={17} color={can(role.permissions, entry.bit) ? colors.brand : colors.textDim} />
          <Text style={styles.checkLabel}>{t(entry.label)}</Text>
        </Pressable>)}
        {role.is_default
          ? <Text style={styles.meta}>{t("The default role cannot be deleted.")}</Text>
          : <Pressable accessibilityRole="button" testID={`delete-role-${role.id}`} disabled={disabled} onPress={() => void removeRole(role)} style={styles.danger}><Ionicons name="trash-outline" size={15} color={colors.error} /><Text style={styles.dangerText}>{t("Delete role")}</Text></Pressable>}
      </View> : null}
    </View>)}
    <View style={styles.addRow}><TextInput value={roleName} onChangeText={setRoleName} maxLength={32} editable={!disabled} placeholder={t("new-role")} placeholderTextColor={colors.textDim} style={styles.input} testID="new-role-name" /><Pressable accessibilityRole="button" testID="create-role" disabled={disabled || roleName.trim().length < 2} accessibilityLabel={t("Create role")} onPress={() => void addRole()} style={[styles.approve, { opacity: disabled || roleName.trim().length < 2 ? 0.4 : 1 }]}><Ionicons name="add" size={20} color={colors.brandOn} /></Pressable></View>

    <Text style={styles.section}>{t("CHANNELS")}</Text>
    <Text style={styles.meta}>{t("Publish channel name and opted-in contributor count in rankings. Messages remain members-only. Public communities only.")}</Text>
    {channels.map(channel => <View key={channel.id}>
      <View style={styles.row}>
        <Text style={styles.hash}>#</Text>
        <Pressable accessibilityRole="button" testID={`channel-${channel.id}`} onPress={() => { setOpenChannel(openChannel === channel.id ? null : channel.id); setOverwriteRole(null); }} style={{ flex: 1 }}>
          <Text style={styles.name}>{channel.name}</Text>
          <Text style={styles.meta}>{channel.is_default ? t("DEFAULT") : t((channel.kind ?? "text").toUpperCase())}</Text>
        </Pressable>
        <Switch testID={`ranking-${channel.id}`} accessibilityLabel={t("Publish channel in rankings")} value={channel.ranking_opt_in ?? false} disabled={disabled} onValueChange={value => void publishChannel(channel, value)} trackColor={{ true: colors.brand }} />
      </View>
      {openChannel === channel.id ? <View style={styles.panel} testID={`channel-panel-${channel.id}`}>
        <Text style={styles.meta}>{t("Pick a role, then tap a permission to cycle inherit → allow → deny.")}</Text>
        <View style={styles.chipRow}>{roles.map(role => <Pressable key={role.id} accessibilityRole="button" testID={`overwrite-role-${channel.id}-${role.id}`} onPress={() => setOverwriteRole(overwriteRole === role.id ? null : role.id)} style={[styles.chip, overwriteRole === role.id && styles.chipOn]}><Text style={styles.chipText}>{role.name}</Text></Pressable>)}</View>
        {overwriteRole ? PERMISSION_LIST.map(entry => {
          const state = triFor(channel, overwriteRole, entry.bit);
          return <Pressable key={entry.key} accessibilityRole="button" accessibilityLabel={`${t(entry.label)}: ${t(state)}`} testID={`overwrite-${channel.id}-${overwriteRole}-${entry.key}`} disabled={disabled} onPress={() => void cycleOverwrite(channel, overwriteRole, entry.bit)} style={styles.checkRow}>
            <Ionicons name={state === "allow" ? "checkmark-circle" : state === "deny" ? "close-circle" : "remove-circle-outline"} size={17} color={state === "allow" ? colors.brand : state === "deny" ? colors.error : colors.textDim} />
            <Text style={styles.checkLabel}>{t(entry.label)}</Text>
            <Text style={styles.meta}>{t(state)}</Text>
          </Pressable>;
        }) : null}
      </View> : null}
    </View>)}
    <View style={styles.addRow}><TextInput value={channelName} onChangeText={setChannelName} maxLength={50} editable={!disabled} placeholder={t("new-channel")} placeholderTextColor={colors.textDim} style={styles.input} /><Pressable accessibilityRole="button" disabled={disabled || channelName.trim().length < 2} accessibilityLabel={t("Create channel")} onPress={() => void addChannel()} style={[styles.approve, { opacity: disabled || channelName.trim().length < 2 ? 0.4 : 1 }]}><Ionicons name="add" size={20} color={colors.brandOn} /></Pressable></View>

    <Text style={styles.section}>{t("ALL MEMBERS")}</Text>
    {active.map(member => {
      const assigned = member.role_ids ?? [];
      return <View key={member.id}>
        <Pressable accessibilityRole="button" testID={`member-${member.id}`} onPress={() => setOpenMember(openMember === member.id ? null : member.id)} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={styles.name}>{member.user?.full_name || t("Member")}</Text><Text style={styles.meta}>{t(member.role.toUpperCase())}{assigned.length ? ` · ${assigned.length}` : ""}</Text></View>
          <Text style={styles.active}>{t("ACTIVE")}</Text>
        </Pressable>
        {openMember === member.id ? <View style={styles.panel} testID={`member-panel-${member.id}`}>
          {roles.filter(role => !role.is_default).length
            ? roles.filter(role => !role.is_default).map(role => <Pressable key={role.id} accessibilityRole="checkbox" accessibilityState={{ checked: assigned.includes(role.id) }} testID={`member-${member.id}-role-${role.id}`} disabled={disabled} onPress={() => void flipMemberRole(member, role.id)} style={styles.checkRow}>
              <Ionicons name={assigned.includes(role.id) ? "checkbox" : "square-outline"} size={17} color={assigned.includes(role.id) ? colors.brand : colors.textDim} />
              <Text style={styles.checkLabel}>{role.name}</Text>
            </Pressable>)
            : <Text style={styles.meta}>{t("Create a role to assign it here.")}</Text>}
        </View> : null}
      </View>;
    })}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, section: { ...type.section, marginTop: spacing.xl, marginBottom: spacing.sm }, row: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, name: { color: colors.text, fontWeight: "800", flex: 1 }, meta: { color: colors.textMuted, fontSize: 10, marginTop: 3 }, approve: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, active: { color: colors.brand, fontSize: 10, fontWeight: "900" }, hash: { color: colors.brand, fontSize: 20, fontWeight: "900" }, empty: { color: colors.textMuted, paddingVertical: spacing.lg }, addRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }, input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colors.text }, error: { color: colors.error }, swatch: { width: 10, height: 10, borderRadius: 5 }, panel: { paddingVertical: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.borderStrong, marginBottom: spacing.sm }, checkRow: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.sm }, checkLabel: { color: colors.text, fontSize: 13, flex: 1 }, danger: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, minHeight: 40 }, dangerText: { color: colors.error, fontSize: 12, fontWeight: "800" }, chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: spacing.sm }, chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong }, chipOn: { borderColor: colors.brand, backgroundColor: colors.surface2 }, chipText: { color: colors.text, fontSize: 11, fontWeight: "800" } });
