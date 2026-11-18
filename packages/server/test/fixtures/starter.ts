import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A stand-in for `bukit new` (plan 5.2) in tests without a real Bukit: `starter/` is the output of
 * `bukit new starter --title="My Site" --language=en-US` from the bundled Bukit; this copies it and sets the
 * values `bukit new` sets (not the Chinese theme text of a Simplified Chinese site). Regenerate `starter/` with the real command after raising BUKIT_VERSION. Run as a
 * script (`new <dir> --title=… --language=…`), it is the `new` command of the end-to-end Bukit stand-in.
 */
export const STARTER_FIXTURE = path.join(import.meta.dirname, "starter");

/** Bukit's site.name: a lower-case ASCII slug of the title, or "site". */
function slug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/, "") || "site"
  );
}

export function writeStarter(target: string, values: { title: string; language: string }): void {
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) throw new Error(`${target} must be empty.`);
  fs.cpSync(STARTER_FIXTURE, target, { recursive: true });
  const file = path.join(target, "site.yaml");
  const title = values.title.trim();
  // Bukit writes these lines as text, with the title as a double-quoted YAML (JSON) string.
  let yaml = fs.readFileSync(file, "utf8");
  for (const [from, to] of [
    ["  name: my-site\n", `  name: ${slug(title)}\n`],
    ['  title: "My Site"\n', `  title: ${JSON.stringify(title)}\n`],
    ["  languages:\n  - en-US\n", `  languages:\n  - ${values.language}\n`],
    ['    brand: "My Site"\n', `    brand: ${JSON.stringify(title)}\n`],
    ['    footer_text: "My Site"\n', `    footer_text: ${JSON.stringify(title)}\n`],
  ] as const) {
    if (!yaml.includes(from)) throw new Error(`the starter site.yaml has no ${JSON.stringify(from)}`);
    yaml = yaml.replace(from, () => to);
  }
  fs.writeFileSync(file, yaml);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, target, ...options] = process.argv.slice(2);
  const option = (name: string) => options.find((o) => o.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (command !== "new" || !target) {
    console.error("usage: new <dir> --title=<text> --language=<tag>");
    process.exit(2);
  }
  writeStarter(path.resolve(target), { title: option("title") ?? "My Site", language: option("language") ?? "en-US" });
  console.log(`Created: ${path.resolve(target)}`);
}
