import { describe, expect, it } from "vitest";
import { parseRobots, robotsAllows } from "./robots.ts";

const rules = parseRobots(`
# a comment
User-agent: *
Disallow: /private/
Allow: /private/public/
Disallow: /*.pdf$
Disallow: /search?q=

User-agent: OtherBot
Disallow: /
`);

describe("robots.txt (design 6.1)", () => {
  it("finds the paths a page may not be captured from, without enforcing them", () => {
    expect(robotsAllows(rules, "/")).toBe(true);
    expect(robotsAllows(rules, "/blog/hello/")).toBe(true);
    expect(robotsAllows(rules, "/private/secret")).toBe(false);
    expect(robotsAllows(rules, "/private/public/page")).toBe(true);
    expect(robotsAllows(rules, "/files/a.pdf")).toBe(false);
    expect(robotsAllows(rules, "/search?q=x")).toBe(false);
  });

  it("handles several groups and agent names", () => {
    expect(robotsAllows(rules, "/anything", "OtherBot")).toBe(false);
    expect(robotsAllows(rules, "/anything", "BukitJalil")).toBe(true);
    expect(parseRobots("Disallow: /\n")).toEqual([]);
  });
});
