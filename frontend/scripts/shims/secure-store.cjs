const store = new Map();
module.exports = {
  async getItemAsync(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async setItemAsync(key, value) {
    store.set(key, value);
  },
  async deleteItemAsync(key) {
    store.delete(key);
  },
};
