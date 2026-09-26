import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { FileChange, ThemeFiles } from "../shared";
import { atomicWrite, scopedPath } from "./files";
import { maxSourceFile, maxSourceBytes, sourcePath, validateSource } from "./source";

const directories = new Set(["content", "themes", "themes/canopy", "themes/canopy/assets",
  "themes/canopy/layouts", "themes/canopy/layouts/pages", "themes/canopy/layouts/layouts", "themes/canopy/layouts/partials"]);
export const sourceHash = (files: ThemeFiles) => createHash("sha256")
  .update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
export const manifestHash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function readCopy(root: string): Promise<ThemeFiles> {
  if ((await fs.realpath(root)) !== root || (await fs.lstat(root)).isSymbolicLink())
    throw new Error("生成副本目录被替换。");
  const files: ThemeFiles = {};
  let count = 0, bytes = 0;
  async function visit(relative: string) {
    for (const entry of await fs.readdir(relative ? await scopedPath(root, relative) : root, { withFileTypes: true })) {
      if (++count > 80) throw new Error("副本文件或目录数量超过限制。");
      const name = relative ? relative + "/" + entry.name : entry.name;
      const filename = await scopedPath(root, name);
      if (entry.isDirectory()) {
        if (!directories.has(name)) throw new Error("不允许的副本目录：" + name);
        await visit(name);
      } else {
        if (!sourcePath(name)) throw new Error("不允许的源文件路径或类型：" + name);
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxSourceFile || (bytes += stat.size) > maxSourceBytes)
          throw new Error("副本包含无效文件或超过大小限制。");
        files[name] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await fs.readFile(filename));
      }
    }
  }
  await visit("");
  return validateSource(files);
}
export function fileChanges(before: ThemeFiles, after: ThemeFiles): FileChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((name) =>
    before[name] === after[name] ? [] : [{ path: name,
      kind: !(name in before) ? "added" : !(name in after) ? "deleted" : "modified",
      before: before[name] ?? null, after: after[name] ?? null }]);
}

export class GenerationCopy {
  readonly id = randomUUID();
  root = "";
  private reviewed: ThemeFiles | null = null;
  constructor(readonly baseline: string, readonly before: ThemeFiles) {}

  async create(dataDir: string) {
    this.root = await scopedPath(dataDir, "generation-copies/" + this.id);
    await fs.mkdir(this.root, { recursive: true });
    for (const [name, text] of Object.entries(validateSource(this.before))) await atomicWrite(this.root, name, text);
  }
  async edit(value: unknown, signal: AbortSignal) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((key) => key !== "files")) throw new Error("副本编辑参数无效。");
    const files = (value as { files?: unknown }).files;
    if (!Array.isArray(files) || files.length < 1 || files.length > 64) throw new Error("副本编辑文件列表无效。");
    const current = await readCopy(this.root), next = { ...current }, names = new Set<string>();
    for (const file of files) {
      if (!file || typeof file !== "object" || Object.keys(file).some((key) => !["path", "content"].includes(key)) ||
          typeof file.path !== "string" || !sourcePath(file.path) || names.has(file.path) ||
          !(file.content === null || typeof file.content === "string")) throw new Error("不允许的副本编辑路径、类型或重复文件。");
      names.add(file.path);
      if (file.content === null) delete next[file.path]; else next[file.path] = file.content;
    }
    validateSource(next); // Validate the complete result before the first write.
    for (const name of names) {
      signal.throwIfAborted();
      if (name in next) await atomicWrite(this.root, name, next[name]);
      else await fs.rm(await scopedPath(this.root, name), { force: true });
    }
    signal.throwIfAborted();
  }
  async review() {
    this.reviewed = await readCopy(this.root);
    return { hash: sourceHash(this.reviewed), changes: fileChanges(this.before, this.reviewed) };
  }
  async approved(hash: string, baseline: string) {
    if (!this.reviewed || hash !== sourceHash(this.reviewed) || manifestHash(baseline) !== manifestHash(this.baseline) ||
        sourceHash(await readCopy(this.root)) !== hash)
      throw new Error("正式项目或生成副本已变化，审批失效；请重新生成并审核。");
    // Apply only this immutable reviewed snapshot, never reread files while committing.
    return structuredClone(this.reviewed);
  }
  async remove() {
    if (!this.root) return;
    // Only this in-memory, application-created UUID directory is eligible for deletion.
    await scopedPath(path.dirname(path.dirname(this.root)), "generation-copies/" + this.id);
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

export const editCopyTool = {
  type: "function", name: "edit_website_copy", deferLoading: false,
  description: "Edit only the application's disposable website copy. Supply complete UTF-8 file content; null deletes a file. No execution, host reads, external actions or changes to the official project. Supported paths: site.yaml (title only); content/*.md; themes/canopy/layouts/{pages,layouts,partials}/*.html; themes/canopy/assets/*.css. Preserve theme.yaml and required template files. Max 64 files, 256 KB/file, 1 MB total.",
  inputSchema: { type: "object", additionalProperties: false, required: ["files"], properties: {
    files: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false,
      required: ["path", "content"], properties: { path: { type: "string" }, content: { type: ["string", "null"] } } } },
  } },
};

// Keep this one client tool directly callable when the native model uses code_mode_only.
export const editCopyNamespace = { type: "namespace", name: "bukitjalil",
  description: "Edit only the application-owned disposable website copy for review.", tools: [editCopyTool] };
export const directCopyToolConfig = `features.code_mode={enabled=false,direct_only_tool_namespaces=[${JSON.stringify(editCopyNamespace.name)}]}`;
