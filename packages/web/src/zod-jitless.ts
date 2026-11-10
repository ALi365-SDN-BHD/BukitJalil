import { config, z } from "zod/v4";

// The admin CSP forbids eval. Without jitless, zod probes `new Function` when object schemas are created
// and the browser reports a CSP violation. vite.config.ts points every `import ... from "zod"` (shared's
// schemas included) here, so the setting always comes first, however the bundle is split into chunks.
config({ jitless: true });

export * from "zod/v4";
export { z, z as default };
