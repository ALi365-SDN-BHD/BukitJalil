import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project, Revision, ThemeCopy, BuildRecord } from "../shared";
import { atomicWrite, readText } from "./files";
import { themePaths } from "./theme";
import { validateSource, sourceHeadline } from "./source";

export const manifestFile = "bukitjalil.json";
export const isId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );

export function textField(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error(`请输入 1–${max} 个字符的单行文字。`);
  }
  return value.trim();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("项目文件格式无效。");
  return value as Record<string, unknown>;
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("项目日期无效。");
  return value;
}

function validateTheme(value: unknown): ThemeCopy | null {
  if (value === null) return null;
  const theme = record(value),
    files = record(theme.files);
  if (
    theme.name !== "Canopy" ||
    theme.version !== "1.0.0" ||
    Object.keys(files).length !== themePaths.length
  )
    throw new Error("不支持此主题副本格式。");
  const result: Record<string, string> = {};
  for (const filename of themePaths) {
    const text = files[filename];
    if (typeof text !== "string" || text.length > 256_000)
      throw new Error("主题文件无效或过大。");
    result[filename] = text;
  }
  return { name: "Canopy", version: "1.0.0", files: result };
}

export function validateProject(value: unknown): Project {
  const data = record(value);
  if (
    (data.format !== 1 && data.format !== 2) ||
    !Array.isArray(data.revisions) ||
    data.revisions.length < 1 ||
    data.revisions.length > 500
  )
    throw new Error("不是支持的 BukitJalil 项目。");
  const revisions: Revision[] = data.revisions.map((value) => {
    const revision = record(value);
    if (!isId(revision.id)) throw new Error("版本编号无效。");
    return {
      id: revision.id,
      createdAt: validDate(revision.createdAt),
      headline: textField(revision.headline, 120),
      summary: textField(revision.summary, 300),
      theme: validateTheme(revision.theme),
      ...(revision.sourceFiles === undefined ? {} : { sourceFiles: validateSource(revision.sourceFiles) }),
    };
  });
  for (const revision of revisions) {
    if (data.format === 1 && revision.sourceFiles) throw new Error("扩展源文件快照需要项目格式 2。");
    if (revision.sourceFiles && (!revision.theme || sourceHeadline(revision.sourceFiles) !== revision.headline))
      throw new Error("源文件快照与版本标题或主题不一致。");
  }
  const ids = new Set(revisions.map((r) => r.id));
  if (
    ids.size !== revisions.length ||
    typeof data.currentRevisionId !== "string" ||
    !ids.has(data.currentRevisionId)
  )
    throw new Error("当前版本不存在。");
  const project: Project = {
    format: data.format,
    name: textField(data.name, 60),
    currentRevisionId: data.currentRevisionId,
    revisions,
  };
  if (data.lastBuild !== undefined) {
    const build = record(data.lastBuild);
    if (
      !isId(build.id) ||
      !isId(build.revisionId) ||
      !ids.has(build.revisionId) ||
      !["running", "success", "failed", "cancelled", "interrupted"].includes(
        String(build.status),
      ) ||
      typeof build.log !== "string" ||
      build.log.length > 64_000 ||
      (build.error !== undefined && typeof build.error !== "string")
    )
      throw new Error("构建记录无效。");
    project.lastBuild = {
      id: build.id,
      revisionId: build.revisionId,
      startedAt: validDate(build.startedAt),
      status: build.status as BuildRecord["status"],
      log: build.log,
      ...(build.error ? { error: String(build.error).slice(0, 2000) } : {}),
    };
  }
  if (data.lastSuccessfulBuild !== undefined) {
    const success = record(data.lastSuccessfulBuild);
    if (
      !isId(success.id) ||
      !isId(success.revisionId) ||
      !ids.has(success.revisionId)
    )
      throw new Error("成功构建记录无效。");
    project.lastSuccessfulBuild = {
      id: success.id,
      revisionId: success.revisionId,
    };
  }
  return project;
}

export function newRevision(
  headline: string,
  theme: ThemeCopy | null,
  summary: string,
): Revision {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    headline: textField(headline, 120),
    theme: structuredClone(theme),
    summary,
  };
}

export class ProjectStore {
  private original = "";
  private constructor(
    readonly root: string,
    public data: Project,
  ) {}

  static async create(directory: string, name: string): Promise<ProjectStore> {
    name = textField(name, 60);
    // mkdir without recursive never overwrites an existing folder or project.
    const parent = await fs.realpath(path.dirname(directory));
    const root = path.join(parent, path.basename(directory));
    await fs.mkdir(root);
    const revision = newRevision(
      "让你的想法，在这里生长。",
      null,
      "创建本地项目",
    );
    const store = new ProjectStore(root, {
      format: 1,
      name,
      currentRevisionId: revision.id,
      revisions: [revision],
    });
    await store.save(store.data, true);
    return store;
  }

  static async open(directory: string): Promise<ProjectStore> {
    if ((await fs.lstat(directory)).isSymbolicLink())
      throw new Error("请选择项目目录本身，不能使用符号链接。");
    const root = await fs.realpath(directory);
    const original = await readText(root, manifestFile);
    const store = new ProjectStore(root, validateProject(JSON.parse(original)));
    store.original = original;
    return store;
  }

  current(): Revision {
    return this.data.revisions.find(
      (r) => r.id === this.data.currentRevisionId,
    )!;
  }

  async unchanged(): Promise<string> {
    const text = await readText(this.root, manifestFile);
    if (text !== this.original) throw new Error("项目已被其他程序修改。请重新打开后再操作，现有文件已保留。");
    return text;
  }

  async save(data: Project, creating = false): Promise<void> {
    if (!creating) await this.unchanged();
    data = validateProject(data);
    const content = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(content) > 8 * 1024 * 1024)
      throw new Error("项目历史已达到 8 MB，请创建新项目后继续。");
    await atomicWrite(this.root, manifestFile, content, creating ? undefined : () => this.unchanged().then(() => {}));
    this.original = content;
    this.data = data;
  }

  async revise(revision: Revision): Promise<void> {
    // ponytail: embedded snapshots cap history at 500 revisions / 8 MB; use separate snapshot files when needed.
    await this.save({
      ...this.data,
      format: revision.sourceFiles ? 2 : this.data.format,
      currentRevisionId: revision.id,
      revisions: [...this.data.revisions, revision],
    });
  }
}
