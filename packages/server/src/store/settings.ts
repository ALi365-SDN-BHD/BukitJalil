import type { DatabaseSync } from "node:sqlite";
import { defaultSettings, Settings, type SettingsPatch } from "@bukitjalil/shared";

/** Global settings stored as one JSON value per key (plan 4.2). Unknown or invalid values fall back to defaults. */
export class SettingsStore {
  constructor(private readonly db: DatabaseSync) {}

  get(): Settings {
    const rows = this.db.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
    const raw: Record<string, unknown> = { ...defaultSettings };
    for (const row of rows) {
      if (row.key in defaultSettings) {
        try {
          raw[row.key] = JSON.parse(row.value_json);
        } catch {
          // keep the default for a corrupt value
        }
      }
    }
    const parsed = Settings.safeParse(raw);
    return parsed.success ? parsed.data : { ...defaultSettings };
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
