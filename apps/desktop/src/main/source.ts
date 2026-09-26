import type { Revision, ThemeFiles } from "../shared";
import { aboutPage, sampleTheme, siteConfig, themePaths } from "./theme";

export const maxSourceFile = 256_000;
export const maxSourceBytes = 1_000_000;
export function sourcePath(name: string): boolean {
  return name === "site.yaml" || name === "themes/canopy/theme.yaml" ||
    /^content\/[a-z0-9][a-z0-9-]*\.md$/.test(name) ||
    /^themes\/canopy\/layouts\/(pages|layouts|partials)\/[a-z0-9][a-z0-9-]*\.html$/.test(name) ||
    /^themes\/canopy\/assets\/[a-z0-9][a-z0-9-]*\.css$/.test(name);
}
export function sourceFiles(revision: Revision): ThemeFiles {
  return structuredClone(revision.sourceFiles ?? {
    "site.yaml": siteConfig(revision.headline),
    "content/about.md": aboutPage,
    ...(revision.theme?.files ?? {}),
  });
}
export function sourceHeadline(files: ThemeFiles): string {
  try {
    const value: unknown = JSON.parse(/^  title: (.+)$/m.exec(files["site.yaml"])![1]);
    if (typeof value === "string" && value.trim() === value && value.length > 0 &&
        value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value) && files["site.yaml"] === siteConfig(value))
      return value;
  } catch { /* Do not parse or execute arbitrary YAML configuration. */ }
  throw new Error("site.yaml 只允许修改标题，构建路径与数据来源必须保持应用配置。");
}
export function validateSource(value: unknown): ThemeFiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("源文件快照无效。");
  const entries = Object.entries(value);
  if (entries.length > 64) throw new Error("副本最多支持 64 个源文件。");
  const files: ThemeFiles = {};
  let total = 0;
  for (const [name, text] of entries) {
    if (!sourcePath(name)) throw new Error("不允许的源文件路径或类型：" + name.slice(0, 200));
    if (typeof text !== "string" || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ||
        Buffer.byteLength(text) > maxSourceFile || Buffer.from(text).toString("utf8") !== text)
      throw new Error("源文件必须是有效 UTF-8 文本且不超过 256 KB：" + name);
    total += Buffer.byteLength(text);
    files[name] = text;
  }
  if (total > maxSourceBytes) throw new Error("副本源文件合计超过 1 MB。");
  sourceHeadline(files);
  if (themePaths.some((name) => !(name in files)) ||
      files["themes/canopy/theme.yaml"] !== sampleTheme().files["themes/canopy/theme.yaml"])
    throw new Error("Canopy 主题清单与必需模板必须保留。");
  return files;
}
