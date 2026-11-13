import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PublishAccount, PublishAccountRequest } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { JsonFile, JsonFileError, type StoredJson } from "../store/json-file.ts";

interface Row {
  id: string;
  name: string;
  platform: "github";
  created_at: string;
}

export const MAX_TOKEN_FILE = 256 * 1024;
const GITHUB_API = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 10_000;

/**
 * Saved publishing accounts (plan 6.5): one GitHub token each, named and identified so a site can pick
 * one. Tokens live in a 0600 file keyed by account id, never in the database or an API response.
 */
export class PublishAccountService {
  private readonly tokens: StoredJson;

  constructor(
    private readonly opts: {
      db: DatabaseSync;
      /** A path (plain 0600 file) or the secret store's file (plan 6.7). */
      tokenFile: string | StoredJson;
      /** null in tests and offline mode: repository access cannot be checked. */
      fetchImpl: typeof fetch | null;
      githubApi?: string;
    },
  ) {
    this.tokens =
      typeof opts.tokenFile === "string" ? new JsonFile(opts.tokenFile, { maxBytes: MAX_TOKEN_FILE }) : opts.tokenFile;
  }

  list(): PublishAccount[] {
    const rows = this.opts.db.prepare("SELECT * FROM publish_accounts ORDER BY rowid").all() as unknown as Row[];
    const tokens = this.readTokens();
    return rows.map((row) => this.view(row, tokens[row.id] ?? null));
  }

  get(id: string): PublishAccount {
    return this.view(this.row(id), this.token(id));
  }

  create(req: PublishAccountRequest): PublishAccount {
    this.assertName(req.name);
    const token = req.token?.trim();
    if (!token) throw new SiteError("publish.no_token", 400);
    const id = newId();
    // The token is written first; a corrupt token file must not leave a database row behind.
    this.writeToken(id, token);
    try {
      this.opts.db
        .prepare("INSERT INTO publish_accounts (id, name, platform, created_at) VALUES (?, ?, ?, ?)")
        .run(id, req.name, req.platform, new Date().toISOString());
    } catch (err) {
      try {
        this.removeToken(id);
      } catch {
        // The database error is the useful one; the next account can still be created.
      }
      throw err;
    }
    return this.get(id);
  }

  update(id: string, req: PublishAccountRequest): PublishAccount {
    this.row(id);
    this.assertName(req.name, id);
    if (req.token === undefined) {
      // Even a name-only edit must not proceed when the token file cannot be read.
      this.token(id);
    } else {
      const token = req.token.trim();
      if (!token) throw new SiteError("publish.no_token", 400);
      // Token first: a failed token write must not leave a renamed account with the old token.
      this.writeToken(id, token);
    }
    this.opts.db
      .prepare("UPDATE publish_accounts SET name = ?, platform = ? WHERE id = ?")
      .run(req.name, req.platform, id);
    return this.get(id);
  }

  remove(id: string): void {
    this.row(id);
    const used = this.opts.db.prepare("SELECT COUNT(*) AS count FROM sites WHERE publish_account_id = ?").get(id) as {
      count: number;
    };
    if (used.count > 0) throw new SiteError("publish.in_use", 409, { count: String(used.count) });
    // Token first: never leave a secret file entry without its account.
    this.removeToken(id);
    this.opts.db.prepare("DELETE FROM publish_accounts WHERE id = ?").run(id);
  }

  /** Remove token entries whose account no longer exists; returns the number removed. */
  pruneUnknownTokens(): number {
    const rows = this.opts.db.prepare("SELECT id FROM publish_accounts").all() as { id: string }[];
    const known = new Set(rows.map((row) => row.id));
    const tokens = this.readTokens();
    const kept = Object.fromEntries(Object.entries(tokens).filter(([id]) => known.has(id)));
    const removed = Object.keys(tokens).length - Object.keys(kept).length;
    if (removed > 0) this.writeTokens(kept);
    return removed;
  }

  /** Remove temporary files left by a killed write; returns the number removed. */
  cleanupTempFiles(): number {
    return this.tokens.cleanupTempFiles();
  }

  /** The GitHub token for an account, or null. */
  token(id: string): string | null {
    return this.readTokens()[id] ?? null;
  }

  /**
   * Throw unless the account's token can push to `repo`. Offline mode cannot check the API and leaves the
   * decision to the deploy itself; when online, GitHub's own permission flag is the answer.
   */
  async verifyRepo(id: string, repo: string): Promise<void> {
    if (!this.opts.fetchImpl) return;
    const token = this.token(id);
    if (!token) throw new SiteError("publish.no_token", 409);
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new SiteError("publish.repo_access", 409);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
    try {
      const res = await this.opts.fetchImpl(
        `${this.opts.githubApi ?? GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "BukitJalil",
          },
          signal: controller.signal,
        },
      );
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new SiteError("publish.repo_access", 409);
      }
      if (!res.ok) throw new SiteError("publish.github_failed", 503);
      const json: unknown = await res.json();
      const permissions = json && typeof json === "object" ? (json as { permissions?: unknown }).permissions : null;
      if (permissions && typeof permissions === "object" && (permissions as { push?: unknown }).push === false) {
        throw new SiteError("publish.repo_access", 409);
      }
    } catch (err) {
      if (err instanceof SiteError) throw err;
      throw new SiteError("publish.github_failed", 503);
    } finally {
      clearTimeout(timer);
    }
  }

  private row(id: string): Row {
    const row = this.opts.db.prepare("SELECT * FROM publish_accounts WHERE id = ?").get(id) as unknown as
      | Row
      | undefined;
    if (!row) throw new SiteError("publish.not_found", 404);
    return row;
  }

  private assertName(name: string, except = ""): void {
    const row = this.opts.db.prepare("SELECT id FROM publish_accounts WHERE name = ? AND id <> ?").get(name, except) as
      | { id: string }
      | undefined;
    if (row) throw new SiteError("publish.name_exists", 409);
  }

  private view(row: Row, token: string | null): PublishAccount {
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      createdAt: row.created_at,
      hasToken: token !== null,
      tokenLast4: token !== null && token.length > 8 ? token.slice(-4) : null,
    };
  }

  private readTokens(): Record<string, string> {
    try {
      const value = this.tokens.read();
      if (value === undefined) return {};
      if (!isRecord(value)) throw new JsonFileError(this.tokens.file, "token file is not an object");
      const tokens: Record<string, string> = {};
      for (const [id, token] of Object.entries(value)) {
        if (typeof token !== "string") throw new JsonFileError(this.tokens.file, "token is not a string");
        tokens[id] = token;
      }
      return tokens;
    } catch (err) {
      if (err instanceof JsonFileError) throw new SiteError("storage.unreadable", 500);
      throw err;
    }
  }

  private writeToken(id: string, token: string): void {
    const tokens = this.readTokens();
    tokens[id] = token;
    this.writeTokens(tokens);
  }

  private removeToken(id: string): void {
    const tokens = this.readTokens();
    if (!(id in tokens)) return;
    delete tokens[id];
    this.writeTokens(tokens);
  }

  private writeTokens(tokens: Record<string, string>): void {
    try {
      this.tokens.write(tokens);
    } catch (err) {
      if (err instanceof JsonFileError) throw new SiteError(err.code, 500);
      throw err;
    }
  }
}

function newId(): string {
  return `pub_${randomBytes(6).toString("hex")}`;
}
