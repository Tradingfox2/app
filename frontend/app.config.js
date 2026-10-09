/** Selects the staff web export without changing the member app config. */
module.exports = ({ config }) => {
  if (process.env.IRONFLOW_WEB_TARGET !== "staff") return config;
  const plugins = (config.plugins ?? []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== "expo-router") return plugin;
    const options = Array.isArray(plugin) && plugin[1] && typeof plugin[1] === "object" ? plugin[1] : {};
    return ["expo-router", { ...options, root: "./staff" }];
  });
  return {
    ...config,
    name: "IronFlow Staff",
    plugins,
  };
};
