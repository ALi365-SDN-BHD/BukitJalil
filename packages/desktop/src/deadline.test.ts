import { describe, expect, it } from "vitest";
import { withDeadline } from "./deadline.ts";

describe("withDeadline", () => {
  it("returns the result in time and rejects with the message after the deadline", async () => {
    expect(await withDeadline(Promise.resolve(7), 50, "late")).toBe(7);
    await expect(withDeadline(new Promise(() => {}), 20, "took too long")).rejects.toThrow("took too long");
  });

  it("passes on the work's own error", async () => {
    await expect(withDeadline(Promise.reject(new Error("broke")), 50, "late")).rejects.toThrow("broke");
  });
});
