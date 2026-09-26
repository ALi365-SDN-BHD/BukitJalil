import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
import { siteConfig } from "./theme";

const baseline = parseDocument(siteConfig("示例标题")).toJS() as Record<string, any>;

function read(text: string) {
  const document = parseDocument(text, { uniqueKeys: true, strict: true });
  if (document.errors.length) throw new Error(`site.yaml 格式无效：${document.errors[0].message}`);
  if (!isMap(document.contents) || !isMap(document.get("site", true)))
    throw new Error("site.yaml 必须包含 site 配置映射。");
  const value = document.toJS({ maxAliasCount: 50 }) as Record<string, any>;
  const site = value.site;
  if (typeof site?.name !== "string" || !site.name.trim() ||
      typeof site?.title !== "string" || !site.title.trim() || site.title.trim() !== site.title ||
      site.title.length > 120 || /[\x00-\x1f\x7f]/.test(site.title) ||
      (site.description != null && typeof site.description !== "string"))
    throw new Error("site.yaml 的网站名称、标题或简介无效。");
  if (!isDeepStrictEqual(value.content, baseline.content) ||
      !isDeepStrictEqual(site.collections, baseline.site.collections) ||
      site.plugins !== undefined || site.baseUrl !== "/" ||
      value.theme?.name !== "canopy" || value.build?.output !== "dist" ||
      value.build?.followSymlinks !== false || value.build?.publishDotFiles === true)
    throw new Error("site.yaml 必须保留应用管理的内容来源、页面路由、Canopy 主题与安全构建路径。");
  return { document, value };
}

export function siteInfo(text: string) {
  const { value } = read(text);
  return { title: value.site.title as string, description: (value.site.description ?? "") as string };
}

export function withSiteInfo(text: string, title: string, description: string) {
  if (!title.trim() || title.trim() !== title || title.length > 120 || /[\x00-\x1f\x7f]/.test(title) ||
      description.length > 300 || /[\x00-\x1f\x7f]/.test(description))
    throw new Error("网站标题须为 1–120 字，简介最多 300 字，均为单行文字。");
  const { document } = read(text);
  document.setIn(["site", "title"], title);
  if (description) document.setIn(["site", "description"], description);
  else document.deleteIn(["site", "description"]);
  return document.toString();
}

export function keepOnlyProposedTitle(before: string, proposed: string) {
  const original = read(before), candidate = read(proposed);
  const proposedTitle = candidate.value.site.title as string;
  const isDefault = isDeepStrictEqual(candidate.value, parseDocument(siteConfig(proposedTitle)).toJS());
  candidate.value.site.title = original.value.site.title;
  if (!isDeepStrictEqual(candidate.value, original.value) && !isDefault)
    throw new Error("生成副本只能修改 site.yaml 的网站标题；其他配置请在高级设置中编辑。");
  const { description } = siteInfo(before);
  return withSiteInfo(before, proposedTitle, description);
}
