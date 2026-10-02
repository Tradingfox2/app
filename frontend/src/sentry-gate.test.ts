import assert from "node:assert/strict";

import { sentryEnabled } from "./sentry-gate.ts";

const dsn = "https://public@o1.ingest.sentry.io/1";

assert.equal(
  sentryEnabled({ dsn: undefined, disabled: undefined, nodeEnv: "production", webdriver: false }),
  false,
);
assert.equal(
  sentryEnabled({ dsn: "   ", disabled: undefined, nodeEnv: "production", webdriver: false }),
  false,
);
assert.equal(
  sentryEnabled({ dsn, disabled: undefined, nodeEnv: "production", webdriver: false }),
  true,
);
assert.equal(
  sentryEnabled({ dsn, disabled: "1", nodeEnv: "production", webdriver: false }),
  false,
);
assert.equal(
  sentryEnabled({ dsn, disabled: undefined, nodeEnv: "test", webdriver: false }),
  false,
);
assert.equal(
  sentryEnabled({ dsn, disabled: undefined, nodeEnv: "production", webdriver: true }),
  false,
);
