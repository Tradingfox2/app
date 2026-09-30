function noop() {
  return null;
}
module.exports = {
  useEffect: noop,
  useState(value) {
    return [value, noop];
  },
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  useRef(value) {
    return { current: value };
  },
  useContext() {
    return null;
  },
  createContext() {
    return {};
  },
  createElement: noop,
  Fragment: "Fragment",
};
