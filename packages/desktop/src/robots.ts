/** robots.txt rules (design 6.1): read once before capturing, and only report what is disallowed. */
interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

/** The groups of a robots.txt text; `*` wildcards and `$` ends are kept for matching. */
export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== "allow" && key !== "disallow")) continue;
    if (value === "") continue; // "Disallow:" allows everything
    current.rules.push({ allow: key === "allow", path: value });
  }
  return groups;
}

/** Whether `agent` may fetch `path` (pathname + query) under these rules; the longest matching rule wins. */
export function robotsAllows(groups: Group[], path: string, agent = "*"): boolean {
  const name = agent.toLowerCase();
  const applicable = groups.filter((g) => g.agents.includes("*") || g.agents.some((a) => name.includes(a)));
  let best: { allow: boolean; length: number } | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!matches(rule.path, path)) continue;
      const length = rule.path.replace(/\*/g, "").replace(/\$$/, "").length;
      if (!best || length > best.length || (length === best.length && rule.allow && !best.allow))
        best = { allow: rule.allow, length };
    }
  }
  return best ? best.allow : true;
}

/** robots.txt path matching: `*` is any run of characters, a final `$` anchors the end. */
function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const source = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}
