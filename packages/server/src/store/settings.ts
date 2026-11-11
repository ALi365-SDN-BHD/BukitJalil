import type { DatabaseSync } from "node:sqlite";
import { defaultSettings, Settings, type SettingsPatch } from "@bukitjalil/shared";
import type { z } from "zod";

/** Global settings stored as one JSON value per key (plan 4.2). Unknown or invalid values fall back to defaults. */
export class SettingsStore {
  constructor(private readonly db: DatabaseSync) {}

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
    const stmt = this.db.prepare(
      "INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
    );
    this.db.exec("BEGIN");
    try {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) stmt.run(key, JSON.stringify(value));
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return this.get();
  }
}
