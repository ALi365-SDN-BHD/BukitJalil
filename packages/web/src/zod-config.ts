import { config } from "zod";

// The admin CSP forbids eval. Without jitless, zod probes `new Function` while schemas are created and the
// browser reports a CSP violation. Imported first in main.tsx, before any module that builds schemas.
config({ jitless: true });
