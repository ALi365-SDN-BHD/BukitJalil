import path from "node:path";

/**
 * Environment Pi reads when its modules load (plan 6.1). PI_CODING_AGENT_DIR decides where Pi looks for
 * its tools (rg) and is fixed at module load, not taken from the agentDir passed to the SDK. PI_OFFLINE
 * stops Pi from downloading tools. The other two keep install telemetry and the version check off even
 * if a settings default changes.
 */
export function piEnvironment(piDir: string): Record<string, string> {
  return {
    PI_CODING_AGENT_DIR: path.resolve(piDir),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    PI_SKIP_VERSION_CHECK: "1",
  };
}

/** Set Pi's environment. The entry point calls this before anything can load Pi. */
export function preparePiEnvironment(piDir: string, env: NodeJS.ProcessEnv = process.env): void {
  Object.assign(env, piEnvironment(piDir));
}

/** Throw unless `preparePiEnvironment(piDir)` is in effect; checked before every load of Pi. */
export function assertPiEnvironment(piDir: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const [name, value] of Object.entries(piEnvironment(piDir))) {
    if (env[name] !== value) throw new Error(`${name} must be ${value} before Pi is loaded`);
  }
}
