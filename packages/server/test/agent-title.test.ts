import { describe, expect, it } from "vitest";
import { autoTitle } from "../src/agent/title.ts";

describe("autoTitle", () => {
  it("uses the first meaningful line", () => {
    expect(autoTitle("  Change the home page title  ")).toBe("Change the home page title");
    expect(autoTitle("\n\n请把首页标题改成 **Hello**。\n\n其它内容")).toBe("请把首页标题改成 Hello");
  });

  it("strips markdown and trailing punctuation", () => {
    expect(autoTitle("## Fix `site.yaml` and [deploy](https://example.com)!")).toBe("Fix site.yaml and deploy");
    expect(autoTitle("-   Add a FAQ page?")).toBe("Add a FAQ page");
  });

  it("shortens long messages and rejects empty ones", () => {
    const title = autoTitle("这是一段很长的聊天内容，".repeat(4));
    expect(title).not.toBeNull();
    expect([...(title ?? "")]).toHaveLength(40);
    expect(title?.endsWith("…")).toBe(true);
    expect(autoTitle("   \n\n  ")).toBeNull();
    expect(autoTitle("...")).toBeNull();
  });
});
