import { randomBytes } from "node:crypto";
import type { PublishAccount, PublishAccountRequest } from "@bukitjalil/shared";
import type { FieldVault } from "../security/vault.ts";
import { SiteError } from "../sites/location.ts";
import type { Db } from "../store/db.ts";

interface Row {
  id: string;
  name: string;
  platform: "github";
  created_at: string;
  token_ciphertext: string | null;
}

const TABLE = "publish_accounts";
const GITHUB_API = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 10_000;

/**
 * Saved publishing accounts (plan 6.5): one GitHub token each, named and identified so a site can pick
 * one. Each token is in its row, encrypted with the field key (plan 6.9), never in an API response.
 */
export class PublishAccountService {
  constructor(
    private readonly opts: {
      db: Db;
      vault: FieldVault;
      /** null in tests and offline mode: repository access cannot be checked. */
      fetchImpl: typeof fetch | null;
      githubApi?: string;
    },
  ) {}

  list(): PublishAccount[] {
    const rows = this.opts.db.prepare("SELECT * FROM publish_accounts ORDER BY rowid").all() as Row[];
    return rows.map((row) => this.view(row));
  }

  get(id: string): PublishAccount {
    return this.view(this.row(id));
  }

  create(req: PublishAccountRequest): PublishAccount {
    this.assertName(req.name);
    const token = req.token?.trim();
    if (!token) throw new SiteError("publish.no_token", 400);
    const id = newId();
    this.opts.db
      .prepare("INSERT INTO publish_accounts (id, name, platform, created_at, token_ciphertext) VALUES (?, ?, ?, ?, ?)")
      .run(id, req.name, req.platform, new Date().toISOString(), this.opts.vault.seal(token, TABLE, id));
    return this.get(id);
  }

  update(id: string, req: PublishAccountRequest): PublishAccount {
    const row = this.row(id);
    this.assertName(req.name, id);
    const token = req.token?.trim();
    if (token === "") throw new SiteError("publish.no_token", 400);
    const sealed = token === undefined ? row.token_ciphertext : this.opts.vault.seal(token, TABLE, id);
    this.opts.db
      .prepare("UPDATE publish_accounts SET name = ?, platform = ?, token_ciphertext = ? WHERE id = ?")
      .run(req.name, req.platform, sealed, id);
    return this.get(id);
  }

  remove(id: string): void {
    this.row(id);
    const used = this.opts.db.prepare("SELECT COUNT(*) AS count FROM sites WHERE publish_account_id = ?").get(id) as {
      count: number;
    };
    if (used.count > 0) throw new SiteError("publish.in_use", 409, { count: String(used.count) });
    this.opts.db.prepare("DELETE FROM publish_accounts WHERE id = ?").run(id);
  }

  /** The GitHub token for an account, or null. */
  token(id: string): string | null {
    const row = this.opts.db.prepare("SELECT * FROM publish_accounts WHERE id = ?").get(id) as Row | undefined;
    return row ? this.tokenOf(row) : null;
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
    const row = this.opts.db.prepare("SELECT * FROM publish_accounts WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new SiteError("publish.not_found", 404);
    return row;
  }

  private assertName(name: string, except = ""): void {
    const row = this.opts.db.prepare("SELECT id FROM publish_accounts WHERE name = ? AND id <> ?").get(name, except) as
      | { id: string }
      | undefined;
    if (row) throw new SiteError("publish.name_exists", 409);
  }

  private tokenOf(row: Row): string | null {
    return row.token_ciphertext === null ? null : this.opts.vault.open(row.token_ciphertext, TABLE, row.id);
  }

  private view(row: Row): PublishAccount {
    const token = this.tokenOf(row);
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      createdAt: row.created_at,
      hasToken: token !== null,
      tokenLast4: token !== null && token.length > 8 ? token.slice(-4) : null,
    };
  }
}

function newId(): string {
  return `pub_${randomBytes(6).toString("hex")}`;
}
