/**
 * Loader stand-in so the real `expo-notifications` package can be evaluated
 * outside Metro. It is not a stand-in for Notifications or permission results.
 * OS comes from EXPO_OS, which the check script sets per run.
 */
const OS = process.env.EXPO_OS || "ios";

const Platform = {
  OS,
  Version: 1,
  select(specifics) {
    if (!specifics) return undefined;
    if (Object.prototype.hasOwnProperty.call(specifics, OS)) return specifics[OS];
    if (OS !== "web" && Object.prototype.hasOwnProperty.call(specifics, "native")) return specifics.native;
    return specifics.default;
  },
};

function chain() {
  const fn = function noop() {
    return chain();
  };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === Symbol.toPrimitive) return () => "";
      return chain();
    },
    apply() {
      return chain();
    },
  });
}

const DeviceEventEmitter = {
  addListener() {
    return { remove() {} };
  },
};

const StyleSheet = {
  create(styles) {
    return styles;
  },
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
  flatten(style) {
    return style;
  },
  compose(a, b) {
    return [a, b];
  },
};

class NativeEventEmitter {
  addListener() {
    return { remove() {} };
  }
  removeAllListeners() {}
  emit() {}
}

const named = {
  Platform,
  DeviceEventEmitter,
  NativeEventEmitter,
  StyleSheet,
  AppRegistry: { registerComponent() {} },
  NativeModules: {},
  UIManager: { getViewManagerConfig() { return null; } },
  Dimensions: { get() { return { width: 390, height: 844, scale: 2, fontScale: 1 }; }, addEventListener() { return { remove() {} }; } },
  I18nManager: { isRTL: false },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener() { return { remove() {} }; } },
  Alert: { alert() {} },
  Linking: { openSettings: async () => {}, openURL: async () => {} },
  AppState: { currentState: "active", addEventListener() { return { remove() {} }; } },
  TurboModuleRegistry: { get() { return null; }, getEnforcing() { return chain(); } },
};

module.exports = new Proxy(named, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (prop === "__esModule") return true;
    if (prop === "then") return undefined;
    if (typeof prop === "symbol") return undefined;
    return chain();
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target) {
      return { configurable: true, enumerable: true, value: target[prop] };
    }
    if (prop === "__esModule") {
      return { configurable: true, enumerable: true, value: true };
    }
    return { configurable: true, enumerable: true, value: chain() };
  },
});
