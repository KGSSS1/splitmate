// `npm run test:e2e:staging`: the E2E suite against the deployed staging app.
// Settings come from .env.e2e.local (tests/e2e/support/target.ts).
import "./tests/e2e/support/staging-mode";

import config from "./playwright.config";

export default config;
