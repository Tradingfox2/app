function noop() {
  return null;
}
module.exports = new Proxy(noop, {
  get() {
    return noop;
  },
  apply() {
    return null;
  },
});
