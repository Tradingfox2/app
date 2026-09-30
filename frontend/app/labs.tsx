import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import Svg, { Polyline } from "react-native-svg";
import { api, type BiomarkerSeries, type LabMarker, type LabReport } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const STEP_LABELS: Record<string, string> = {
  received: "Received",
  ocr: "OCR",
  extraction: "Extraction",
  normalization: "Normalization",
  interpretation: "Interpretation",
  write: "Saving",
  callback: "Done",
  pipeline: "Pipeline",
  terra_processing: "Standardizing",
  terra_failed: "Failed",
};

const SEVERITY: Record<string, { color: string; label: string }> = {
  info: { color: colors.info, label: "INFO" },
  attention: { color: colors.warning, label: "ATTENTION" },
  discuss_with_doctor: { color: colors.error, label: "SEE DOCTOR" },
};

function Sparkline({ points }: { points: { value: number }[] }) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 28;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const coords = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`)
    .join(" ");
  return (
    <Svg width={w} height={h}>
      <Polyline points={coords} stroke={colors.text} strokeWidth={2} fill="none" />
    </Svg>
  );
}

function MarkerCard({ m }: { m: BiomarkerSeries }) {
  const { t, formatNumber } = useI18n();
  const out =
    (m.ref_low != null && m.latest < m.ref_low) || (m.ref_high != null && m.latest > m.ref_high);
  return (
    <View style={styles.markerCard} testID={`marker-${m.slug}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.markerName}>{m.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
          <Text style={[styles.markerVal, out && { color: colors.error }]}>{formatNumber(m.latest)}</Text>
          <Text style={styles.markerUnit}>{m.unit}</Text>
        </View>
        {m.ref_low != null && m.ref_high != null && (
          <Text style={styles.markerRef}>
            {t("ref")} {formatNumber(m.ref_low)}–{formatNumber(m.ref_high)} {out ? t("· OUT OF RANGE") : ""}
          </Text>
        )}
      </View>
      <Sparkline points={m.points} />
    </View>
  );
}

function displayMeasurement(marker: LabMarker, t: (source: string) => string) {
  const measurement = marker.measurement;
  if (!measurement) return marker.value == null ? t("Not reported") : `${marker.value} ${marker.unit}`.trim();
  if (measurement.type === "bounded" && measurement.bounded) {
    const symbol = measurement.bounded.operator === "lt" ? "<" : ">";
    return `${symbol}${measurement.bounded.value} ${marker.unit}`.trim();
  }
  if (measurement.type === "qualitative") return measurement.qualitative?.text ?? t("Not reported");
  if (measurement.type === "text") return measurement.text ?? t("Not reported");
  if (measurement.type === "absent") return measurement.absent_reason ?? t("Not reported");
  return `${marker.value ?? measurement.numeric ?? t("Not reported")} ${marker.unit}`.trim();
}

function ReportCard({ report }: { report: LabReport }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const done = report.status === "done";
  const failed = report.status === "failed";
  const interp = report.interpretation;
  return (
    <Pressable
      testID={`report-${report.id}`}
      onPress={() => done && setOpen((o) => !o)}
      accessibilityRole={done ? "button" : undefined}
      accessibilityLabel={done ? t("{name}, view results and AI interpretation", { name: report.filename ?? t("Report") }) : undefined}
      accessibilityState={done ? { expanded: open } : undefined}
      style={styles.reportCard}
    >
      <View style={styles.reportHead}>
        <Ionicons
          name={report.mime === "application/pdf" ? "document-text" : "image"}
          size={18}
          color={colors.textMuted}
        />
        <Text style={styles.reportName} numberOfLines={1}>
          {report.filename ?? t("Report")}
        </Text>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: failed
                ? colors.errorWash
                : done
                  ? colors.surface2
                  : colors.surface3,
            },
          ]}
        >
          {report.status === "processing" && (
            <ActivityIndicator size={10} color={colors.text} style={{ marginRight: 4 }} />
          )}
          <Text
            style={[
              styles.statusTxt,
              { color: colors.text },
            ]}
          >
            {failed ? t("FAILED") : done ? t("{count} MARKERS", { count: report.markers_count }) : t(STEP_LABELS[report.step] ?? report.step).toUpperCase()}
          </Text>
        </View>
        {done ? (
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.textMuted}
          />
        ) : null}
      </View>
      {failed && report.error ? <Text style={styles.errTxt}>{report.error}</Text> : null}
      {report.terra_sessions?.[0]?.report_date ? (
        <Text style={styles.reportMeta}>
          {t("Collected {date} · Standardized by Terra", { date: report.terra_sessions[0].report_date })}
        </Text>
      ) : null}

      {done && open && (
        <View style={{ marginTop: spacing.md }}>
          {report.markers.map((marker, index) => (
            <View key={`${marker.marker_slug}-${index}`} style={styles.resultRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName}>{marker.marker}</Text>
                {marker.loinc_code ? <Text style={styles.resultCode}>LOINC {marker.loinc_code}</Text> : null}
              </View>
              <Text
                style={[
                  styles.resultValue,
                  marker.interpretation_flag && marker.interpretation_flag !== "normal"
                    ? { color: colors.warning }
                    : null,
                ]}
              >
                {displayMeasurement(marker, t)}
              </Text>
            </View>
          ))}
          {interp?.summary.map((s: string, i: number) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletTxt}>{s}</Text>
            </View>
          ))}
          {!!interp?.trends.length && (
            <View style={{ marginTop: spacing.sm }}>
              {interp.trends.map((t: any, i: number) => (
                <View key={i} style={styles.trendRow}>
                  <Ionicons
                    name={
                      t.direction === "up"
                        ? "trending-up"
                        : t.direction === "down"
                          ? "trending-down"
                          : "remove"
                    }
                    size={14}
                    color={colors.text}
                  />
                  <Text style={styles.trendTxt}>
                    {t.marker_slug} — {t.comment}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {interp?.flags.map((f, i) => {
            const sev = SEVERITY[f.severity] ?? SEVERITY.info;
            return (
              <View key={i} style={[styles.flagCard, { borderLeftColor: sev.color }]}>
                <Text style={[styles.flagSev, { color: sev.color }]}>{t(sev.label)}</Text>
                <Text style={styles.flagTxt}>{f.comment}</Text>
              </View>
            );
          })}
          {!interp && report.interpretation_error ? (
            <Text style={styles.interpretationUnavailable}>
              {t("Standardized results are ready. The educational summary is temporarily unavailable.")}
            </Text>
          ) : null}
          <View style={styles.disclaimer} testID="disclaimer-banner">
            <Ionicons name="medkit" size={14} color={colors.warning} />
            <Text style={styles.disclaimerTxt}>{report.disclaimer}</Text>
          </View>
        </View>
      )}
      {done && !open && (
        <Text style={styles.tapHint}>{t("View results and AI interpretation")}</Text>
      )}
    </Pressable>
  );
}

export default function LabsScreen() {
  const { t } = useI18n();
  const [reports, setReports] = useState<LabReport[]>([]);
  const [markers, setMarkers] = useState<BiomarkerSeries[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([api.labReports(), api.biomarkersGrouped()]);
      setReports(r);
      setMarkers(m);
      return r;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // poll while a report is processing
  useEffect(() => {
    const hasProcessing = reports.some((r) => r.status === "processing");
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(load, 5000);
    }
    if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [reports, load]);

  const doUpload = async (file: { uri: string; name: string; mimeType: string }) => {
    setUploading(true);
    try {
      await api.uploadLab(file);
      await load();
    } catch (e: any) {
      Alert.alert(t("Upload failed"), e?.message ?? t("Try again"));
    } finally {
      setUploading(false);
    }
  };

  const pickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload({
      uri: a.uri,
      name: a.name ?? "report.pdf",
      mimeType: a.mimeType ?? "application/pdf",
    });
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!req.granted) {
        Alert.alert(
          t("Photos access needed"),
          t("Allow photo access to upload a picture of your blood panel.")
        );
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload({
      uri: a.uri,
      name: a.fileName ?? "photo.jpg",
      mimeType: a.mimeType ?? "image/jpeg",
    });
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="labs-screen">
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("BLOOD PANELS")}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.text}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.uploadRow}>
          <Pressable
            testID="upload-pdf-btn"
            onPress={pickDocument}
            disabled={uploading}
            style={[styles.uploadBtn, uploading && { opacity: 0.5 }]}
          >
            <Ionicons name="document-attach" size={18} color={colors.brandOn} />
            <Text style={styles.uploadTxt}>{t("UPLOAD PDF / FILE")}</Text>
          </Pressable>
          <Pressable
            testID="upload-photo-btn"
            onPress={pickPhoto}
            disabled={uploading}
            style={[styles.uploadBtnAlt, uploading && { opacity: 0.5 }]}
          >
            <Ionicons name="image" size={18} color={colors.text} />
            <Text style={styles.uploadTxtAlt}>{t("PHOTO")}</Text>
          </Pressable>
        </View>
        {uploading && (
          <View style={styles.uploadingRow}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.uploadingTxt}>{t("Uploading…")}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t("REPORTS")}</Text>
        {reports.length === 0 ? (
          <Text style={styles.emptyTxt}>
            {t("Upload a blood panel (PDF or photo). IronFlow will standardize its results, plot numeric markers over time and give a sport-focused educational read.")}
          </Text>
        ) : (
          reports.map((r) => <ReportCard key={r.id} report={r} />)
        )}

        <Text style={styles.sectionTitle}>{t("MARKERS OVER TIME")}</Text>
        {markers.length === 0 ? (
          <Text style={styles.emptyTxt}>{t("No biomarkers yet.")}</Text>
        ) : (
          markers.map((m) => <MarkerCard key={m.slug} m={m} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 15 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  uploadRow: { flexDirection: "row", gap: spacing.sm },
  uploadBtn: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  uploadTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  uploadBtnAlt: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.text,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  uploadTxtAlt: { color: colors.text, fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  uploadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  uploadingTxt: { color: colors.textMuted, fontSize: 12 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  emptyTxt: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  reportCard: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  reportHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  reportName: { color: colors.text, fontWeight: "700", flex: 1, fontSize: 13 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusTxt: { fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  errTxt: { color: colors.error, fontSize: 12, marginTop: spacing.sm },
  reportMeta: { color: colors.textDim, fontSize: 11, marginTop: spacing.sm },
  tapHint: { color: colors.textDim, fontSize: 11, marginTop: spacing.sm },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  resultName: { color: colors.text, fontSize: 12, fontWeight: "700" },
  resultCode: { color: colors.textDim, fontSize: 9, marginTop: 2 },
  resultValue: { color: colors.text, fontSize: 13, fontWeight: "800", textAlign: "right" },
  interpretationUnavailable: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md },
  bulletRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  bulletDot: { color: colors.text, fontSize: 13 },
  bulletTxt: { color: colors.text, fontSize: 13, lineHeight: 19, flex: 1 },
  trendRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 4 },
  trendTxt: { color: colors.textMuted, fontSize: 12, lineHeight: 17, flex: 1 },
  flagCard: {
    backgroundColor: colors.surface3,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  flagSev: { fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  flagTxt: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 2 },
  disclaimer: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.warningWash,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.md,
    alignItems: "flex-start",
  },
  disclaimerTxt: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
  markerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  markerName: { color: colors.textMuted, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  markerVal: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  markerUnit: { color: colors.textMuted, fontSize: 11 },
  markerRef: { color: colors.textDim, fontSize: 10, marginTop: 2 },
});
