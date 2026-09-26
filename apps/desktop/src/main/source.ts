import type { Revision, ThemeFiles } from "../shared";
import { aboutPage, sampleTheme, siteConfig, themePaths } from "./theme";
import { siteInfo } from "./site-config";

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
  if (typeof files["site.yaml"] !== "string") throw new Error("site.yaml 不存在。");
  return siteInfo(files["site.yaml"]).title;
}
export function validateSource(value: unknown, hasTheme = true): ThemeFiles {
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
  if (hasTheme ? themePaths.some((name) => !(name in files)) ||
      files["themes/canopy/theme.yaml"] !== sampleTheme().files["themes/canopy/theme.yaml"] :
      Object.keys(files).some((name) => name.startsWith("themes/")))
    throw new Error("Canopy 主题清单与必需模板必须保留。");
  return files;
}
