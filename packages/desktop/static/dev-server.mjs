// Development only (plan M7): run the server from its TypeScript sources through tsx, as `pnpm start`
// does. Electron's utility process does not apply `--import tsx`, so tsx is registered here first.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const serverDir = path.resolve(import.meta.dirname, "../../server");
const require = createRequire(path.join(serverDir, "package.json"));
const { register } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
register();
await import(pathToFileURL(path.join(serverDir, "src", "main.ts")).href);
