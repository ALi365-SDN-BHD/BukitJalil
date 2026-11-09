import { errorCodes } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import en from "./en.ts";
import { catalogs, detectLocale, format } from "./index.tsx";
import zhCN from "./zh-CN.ts";

describe("i18n (plan 10.1)", () => {
  it("detects the first supported browser language, defaulting to zh-CN", () => {
    expect(detectLocale(["en-US", "zh-CN"])).toBe("en");
    expect(detectLocale(["zh-TW"])).toBe("zh-CN");
    expect(detectLocale(["fr-FR", "de"])).toBe("zh-CN");
    expect(detectLocale(["fr-FR", "en"])).toBe("en");
    expect(detectLocale([])).toBe("zh-CN");
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(format("git {version}", { version: "2.39" })).toBe("git 2.39");
    expect(format("{a} {b}", { a: 1 })).toBe("1 {b}");
  });

  it("every locale has the same keys and a text for every server error code", () => {
    const keys = (o: object, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(en).sort()).toEqual(keys(zhCN).sort());
    for (const catalog of Object.values(catalogs)) {
      for (const code of errorCodes) expect(catalog.errors[code], code).toBeTruthy();
    }
  });
});
