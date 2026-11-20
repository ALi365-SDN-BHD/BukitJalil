import { defaultSettings, Settings, type SettingsPatch } from "@bukitjalil/shared";
import type { z } from "zod";
import type { Db } from "../store/db.ts";

/** Global settings stored as one JSON value per key (plan 4.2). Unknown or invalid values fall back to defaults. */
export class SettingsStore {
  constructor(private readonly db: Db) {}

  get(): Settings {
    const rows = this.db.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
    const result: Record<string, unknown> = { ...defaultSettings };
    const shape = Settings.shape as Record<string, z.ZodType>;
    for (const row of rows) {
      const field = shape[row.key];
      if (!field) continue;
      try {
        // Each value on its own: one corrupt or outdated value must not reset the others.
        const parsed = field.safeParse(JSON.parse(row.value_json));
        if (parsed.success) result[row.key] = parsed.data;
      } catch {
        // keep the default for a value that is not JSON
      }
    }
    return result as Settings;
  }

  update(patch: SettingsPatch): Settings {
    this.db.exec("BEGIN");
    try {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) this.setValue(key, value);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return this.get();
  }

  /**
   * One row that is not one of the app's settings (the idle lock's minutes, plan 6.9): `get` and the settings
   * API never see it. Undefined when missing or not JSON; the caller checks the value.
   */
  getValue(key: string): unknown {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as
      | { value_json: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json) as unknown;
    } catch {
      return undefined;
    }
  }

  setValue(key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
      )
      .run(key, JSON.stringify(value));
  }
}
