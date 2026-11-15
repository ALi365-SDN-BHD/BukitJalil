import crypto from "node:crypto";

const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const trimMain = (value: string) => value.replace(/^[-.]+|[-.]+$/g, "");

/**
 * A file name the site can store on every supported file system: lower case, ASCII only, one extension,
 * no directory separators, no Windows device names. The result is idempotent (design 4.2).
 */
export function normalizeMediaName(original: string): string {
  const lower = original.normalize("NFKC").toLowerCase();
  const dot = lower.lastIndexOf(".");
  const extension = lower.slice(dot + 1) === "jpeg" ? "jpg" : lower.slice(dot + 1);
  let main = trimMain(
    lower
      .slice(0, dot)
      .replace(/[^a-z0-9._-]/g, "-")
      .replace(/-+/g, "-"),
  ).slice(0, 80);
  main = trimMain(main);
  if (main === "")
    main = `upload-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(2).toString("hex")}`;
  if (RESERVED.has(main)) main = `${main}-file`;
  return `${main}.${extension}`;
}
