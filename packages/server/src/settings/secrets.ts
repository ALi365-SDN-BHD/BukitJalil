import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type SecretName, type SecretStatus, type SecretsResponse, secretNames } from "@bukitjalil/shared";
import { SiteError } from "../sites/location.ts";

/**
 * Notion and GitHub tokens (plan 6.5):
 * 1. the environment variable wins and is read-only in the UI
 * 2. otherwise the value set in the UI, kept in secrets.json (0600, written to a temporary file and renamed)
 * 3. both variables leave process.env as soon as they are read, so no child process inherits them
 * Tokens reach Bukit only when a caller passes them explicitly (plan 8.5).
 */
export const SECRET_ENV = {
  github: "BUKITJALIL_GITHUB_TOKEN",
  notion: "BUKITJALIL_NOTION_TOKEN",
} as const;
export type AnySecret = keyof typeof SECRET_ENV;

const MAX_FILE = 64 * 1024;

export class SecretStore {
  private readonly fromEnv = new Map<AnySecret, string>();

  constructor(
    private readonly file: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    for (const [name, variable] of Object.entries(SECRET_ENV) as [AnySecret, string][]) {
      const value = env[variable]?.trim();
      delete env[variable];
      if (value) this.fromEnv.set(name, value);
    }
  }

  /** The token to pass to Bukit, or null. */
  get(name: AnySecret): string | null {
    return this.fromEnv.get(name) ?? this.read()[name] ?? null;
  }

  status(): SecretsResponse {
    return Object.fromEntries(secretNames.map((name) => [name, this.statusOf(name)])) as SecretsResponse;
  }

  set(name: string, value: string): SecretsResponse {
    const key = this.editable(name);
    this.write({ ...this.read(), [key]: value });
    return this.status();
  }

  remove(name: string): SecretsResponse {
    const key = this.editable(name);
    const { [key]: _gone, ...rest } = this.read();
    this.write(rest);
    return this.status();
  }

  private statusOf(name: SecretName): SecretStatus {
    const label = SECRET_ENV[name];
    if (this.fromEnv.has(name)) return { configured: true, source: "environment", last4: null, label };
    const value = this.read()[name];
    return value
      ? // A short value would be shown whole: only longer ones get their last four.
        { configured: true, source: "stored", last4: value.length > 8 ? value.slice(-4) : null, label }
      : { configured: false, source: null, last4: null, label };
  }

  private editable(name: string): SecretName {
    if (!(secretNames as readonly string[]).includes(name)) throw new SiteError("secret.not_found", 404);
    const key = name as SecretName;
    if (this.fromEnv.has(key)) throw new SiteError("secret.from_environment", 409);
    return key;
  }

  /** The stored tokens; a missing, linked, oversized or unreadable file counts as empty. */
  private read(): Partial<Record<AnySecret, string>> {
    try {
      const stat = fs.lstatSync(this.file, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.size > MAX_FILE) return {};
      const value: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const result: Partial<Record<AnySecret, string>> = {};
      for (const name of Object.keys(SECRET_ENV) as AnySecret[]) {
        const v = (value as Record<string, unknown>)[name];
        if (typeof v === "string" && v.length > 0) result[name] = v;
      }
      return result;
    } catch {
      return {};
    }
  }

  private write(data: Partial<Record<AnySecret, string>>): void {
    const temp = path.join(path.dirname(this.file), `.secrets-${randomBytes(6).toString("hex")}.tmp`);
    try {
      const fd = fs.openSync(temp, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.file);
      fs.chmodSync(this.file, 0o600);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}
