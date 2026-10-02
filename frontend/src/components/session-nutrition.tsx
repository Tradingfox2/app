import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { api } from "@/src/api";
import { useI18n } from "@/src/i18n";
import {
  factsToShow,
  loggedAmount,
  normalizeBarcode,
  nutrientLabel,
  OPINION_SOURCE,
  OPINION_TEXT,
  type NutritionProduct,
  type OpinionId,
} from "@/src/nutrition";
import { useFieldAffordance, usePressFeedback } from "@/src/press-feedback";
import { colors, radius, spacing } from "@/src/theme";

const FAILED: NutritionProduct = {
  ok: false, notice: "lookup_failed", name: null, basis: null, serving_size: null, nutrients: [],
};

function basisLabel(basis: "100g" | "serving"): string {
  switch (basis) {
    case "100g":
      return "Per 100 g";
    case "serving":
      return "Per serving";
    default: {
      const unreachable: never = basis;
      return unreachable;
    }
  }
}

export function SessionNutrition({ workoutId }: { workoutId: string }) {
  const { t, formatNumber } = useI18n();
  const press = usePressFeedback();
  const proteinField = useFieldAffordance();
  const waterField = useFieldAffordance();
  const codeField = useFieldAffordance();
  const [permission, requestPermission] = useCameraPermissions();
  const [protein, setProtein] = useState("");
  const [water, setWater] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraNote, setCameraNote] = useState("");
  const [product, setProduct] = useState<NutritionProduct | null>(null);
  const busyRef = useRef(false);
  const scanned = useRef(false);
  const skipSave = useRef(true);
  const proteinAmount = loggedAmount(protein);
  const waterAmount = loggedAmount(water);
  const facts = factsToShow(product);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const handle = setTimeout(() => {
      void api.saveSessionNutrition(workoutId, {
        protein_g: loggedAmount(protein),
        water_ml: loggedAmount(water),
      }).catch(() => undefined);
    }, 200);
    return () => clearTimeout(handle);
  }, [protein, water, workoutId]);

  const lookup = async (raw: string) => {
    if (busyRef.current) return;
    const barcode = normalizeBarcode(raw);
    if (!barcode) {
      setProduct(FAILED);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      setProduct(await api.nutritionProduct(barcode));
    } catch {
      setProduct(FAILED);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openScan = async () => {
    setCameraNote("");
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        setCameraNote(t("Camera access is needed to scan a barcode."));
        return;
      }
    }
    scanned.current = false;
    setScanning(true);
  };

  const notice = !product
    ? null
    : product.notice === "no_facts"
      ? t("This label has no nutrition facts.")
      : !product.ok || product.notice === "lookup_failed"
        ? t("The product lookup failed.")
        : null;

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    testID: string,
    lineID: string,
    shown: number | null,
    unit: string,
    affordance: ReturnType<typeof useFieldAffordance>,
  ) => (
    <View style={styles.col}>
      <Text style={styles.label}>{t(label)}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        style={[styles.input, affordance.style]}
        {...affordance.hover}
        {...affordance.focus}
      />
      <Text testID={lineID} style={styles.line}>{shown === null ? "" : `${formatNumber(shown)} ${unit}`}</Text>
    </View>
  );

  return (
    <View testID="finish-nutrition">
      <View style={styles.row}>
        {field("Protein (g)", protein, setProtein, "finish-protein", "finish-protein-line", proteinAmount, "g", proteinField)}
        {field("Water (ml)", water, setWater, "finish-water", "finish-water-line", waterAmount, "ml", waterField)}
      </View>
      <View style={styles.scanRow}>
        <TextInput
          testID="finish-barcode"
          value={code}
          onChangeText={setCode}
          placeholder={t("Barcode")}
          placeholderTextColor={colors.textDim}
          keyboardType="number-pad"
          style={[styles.code, codeField.style]}
          {...codeField.hover}
          {...codeField.focus}
        />
        <Pressable accessibilityRole="button" testID="finish-barcode-lookup" disabled={busy} onPress={() => void lookup(code)} style={press("outline", styles.lookup, { disabled: busy })}>
          <Text style={styles.lookupTxt}>{busy ? "…" : t("LOOK UP")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Scan a barcode")} testID="finish-scan" onPress={() => void openScan()} style={press("outline", styles.lookup)}>
          <Text style={styles.lookupTxt}>{t("SCAN")}</Text>
        </Pressable>
      </View>
      {cameraNote ? <Text style={styles.notice}>{cameraNote}</Text> : null}
      {product?.name ? <Text testID="finish-product-name" style={styles.name}>{product.name}</Text> : null}
      {product?.ok && product.basis ? (
        <Text testID="finish-product-basis" style={styles.basis}>
          {t(basisLabel(product.basis))}{product.serving_size ? ` · ${product.serving_size}` : ""}
        </Text>
      ) : null}
      {notice ? <Text testID="finish-nutrition-notice" style={styles.notice}>{notice}</Text> : null}
      {facts.map((row) => {
        const opinion: OpinionId | null = row.opinion;
        return (
          <View key={row.key}>
            <Text testID={`finish-nutrient-${row.key}`} style={styles.fact}>
              {t(nutrientLabel(row.key))} {formatNumber(row.value)} {row.unit}
            </Text>
            {opinion ? (
              <Text testID={`finish-opinion-${row.key}`} style={styles.opinion}>
                {t("Opinion, not professional advice.")} {t(OPINION_TEXT[opinion])}
              </Text>
            ) : null}
            {opinion ? <Text testID={`finish-opinion-source-${row.key}`} style={styles.source}>{OPINION_SOURCE[opinion]}</Text> : null}
          </View>
        );
      })}
      {product?.ok ? (
        <Text testID="finish-off-credit" style={styles.source}>
          {t("Open Food Facts. Database: ODbL. Contents: Database Contents License. Images: CC BY-SA. Not medical.")}
        </Text>
      ) : null}
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scanWrap}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current || busyRef.current) return;
              scanned.current = true;
              setScanning(false);
              setCode(data);
              void lookup(data);
            }}
          />
          <Pressable accessibilityRole="button" testID="finish-scan-cancel" onPress={() => setScanning(false)} style={styles.cancel}>
            <Text style={styles.lookupTxt}>{t("CANCEL")}</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  col: { flex: 1 },
  label: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  input: { minHeight: 40, marginTop: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, fontSize: 16, paddingHorizontal: spacing.sm },
  line: { color: colors.text, fontSize: 14, minHeight: 18, marginTop: 2 },
  scanRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.sm },
  code: { flex: 1, minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, paddingHorizontal: spacing.sm },
  lookup: { minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  lookupTxt: { color: colors.text, fontSize: 11, fontWeight: "800" },
  name: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: spacing.sm },
  basis: { color: colors.textMuted, fontSize: 12 },
  fact: { color: colors.text, fontSize: 14, marginTop: 2 },
  opinion: { color: colors.textMuted, fontSize: 12 },
  source: { color: colors.textDim, fontSize: 11 },
  notice: { color: colors.text, fontSize: 13, marginTop: spacing.xs },
  scanWrap: { flex: 1, backgroundColor: colors.bg },
  camera: { flex: 1 },
  cancel: { minHeight: 48, alignItems: "center", justifyContent: "center" },
});
