import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { State, RecentProject, BuildRecord } from "../shared";
import { ProjectStore, newRevision, isId, textField, manifestFile } from "./project";
import { atomicWrite, readText, scopedPath, checkOutputTree } from "./files";
import { sampleTheme, siteConfig, themePaths } from "./theme";
import { sourceFiles, sourceHeadline } from "./source";
import { GenerationCopy } from "./generation";
import type { CodexChat } from "./codex";
import { ManagedProcess } from "./process";

interface Session {
  recent: RecentProject[];
  lastProjectId?: string;
  binary: string | null;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class Workspace {
  private session: Session = { recent: [], binary: null };
  private store: ProjectStore | null = null;
  private busy = false;
  private closing = false;
  private operation: Promise<unknown> | null = null;
  private abort: AbortController | null = null;
  private buildProcess: ManagedProcess | null = null;
  private previewProcess: ManagedProcess | null = null;
  private preview: State["preview"] = null;
  private notice: string | null = null;
  private sessionReadable = true;
  private unavailable = new Map<string, string>();
  private copy: GenerationCopy | null = null;
  private generation: State["generation"] = null;
  private binaryVersion: string | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly changed: (state: State) => void = () => {},
  ) {}

  state(): State {
    const data = this.store?.data;
    return {
      project:
        data && this.store
          ? {
              ...data,
              path: this.store.root,
              revisions: data.revisions.map(
                ({ theme: _theme, sourceFiles: _files, ...revision }) => revision,
              ),
              themeApplied: !!this.store.current().theme,
              pages: [{ path: "/", title: "首页" }, ...Object.entries(sourceFiles(this.store.current()))
                .filter(([name]) => name.startsWith("content/"))
                .flatMap(([name, text]) => {
                  const slug = /^slug: ([a-z0-9][a-z0-9-]*)$/m.exec(text)?.[1];
                  return slug ? [{ path: "/" + slug + "/", title: slug === "about" ? "关于" : (/^title: (.+)$/m.exec(text)?.[1] ?? name) }] : [];
                })],
            }
          : null,
      recent: this.session.recent.map((recent) => ({
        ...recent, unavailable: this.unavailable.get(recent.id) ?? null,
      })),
      binary: this.session.binary,
      binaryVersion: this.binaryVersion,
      busy: this.busy,
      generation: this.generation ? structuredClone(this.generation) : null,
      preview: this.preview ? { ...this.preview } : null,
      notice: this.notice,
    };
  }
  chatContext() {
    if (!this.store) return null;
    const revision = this.store.current();
    return {
      path: this.store.root,
      name: this.store.data.name,
      snapshot: {
        name: this.store.data.name,
        revisionId: revision.id,
        headline: revision.headline,
        theme: revision.theme ? { name: revision.theme.name, version: revision.theme.version } : null,
        files: sourceFiles(revision),
      },
    };
  }
  private emit() {
    this.changed(this.state());
  }

  async initialize(binary?: string): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const saved = JSON.parse(
        await readText(this.dataDir, "session.json", 128_000),
      ) as Session;
      if (
        !Array.isArray(saved.recent) ||
        saved.recent.length > 20 ||
        saved.recent.some(
          (r) =>
            !isId(r.id) ||
            typeof r.path !== "string" ||
            !path.isAbsolute(r.path) ||
            typeof r.name !== "string" ||
            (r.lastOpenedAt !== undefined &&
              (typeof r.lastOpenedAt !== "string" || !Number.isFinite(Date.parse(r.lastOpenedAt)))),
        ) ||
        !(
          saved.binary === null ||
          (typeof saved.binary === "string" && path.isAbsolute(saved.binary))
        ) ||
        (saved.lastProjectId !== undefined && !isId(saved.lastProjectId))
      )
        throw new Error("最近项目记录格式无效。");
      this.session = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.sessionReadable = false;
        this.notice = `最近项目记录无法读取，原文件已保留：${message(error)}`;
      }
    }
    if (binary) {
      try {
        const checked = await this.inspectEngine(binary);
        this.session.binary = checked.path;
        this.binaryVersion = checked.version;
      } catch (error) {
        this.notice = message(error);
      }
    }
    if (this.session.binary && !this.binaryVersion) {
      try { this.binaryVersion = (await this.inspectEngine(this.session.binary)).version; }
      catch (error) { this.notice = `Bukit 检测失败，原路径已保留：${message(error)}`; }
    }
    await this.refreshRecent();
    this.emit();
  }

  private async saveSession(next = this.session): Promise<void> {
    if (this.sessionReadable)
      await atomicWrite(
        this.dataDir,
        "session.json",
        JSON.stringify(next, null, 2) + "\n",
      );
    this.session = next;
  }
  private async validateBinary(binary: string): Promise<string> {
    if (typeof binary !== "string" || !path.isAbsolute(binary))
      throw new Error("请选择 Bukit 可执行文件的绝对路径。");
    const resolved = await fs.realpath(binary);
    if (!(await fs.stat(resolved)).isFile())
      throw new Error("Bukit 路径必须是可执行文件。");
    await fs.access(resolved, constants.X_OK);
    return resolved;
  }
  private async inspectEngine(binary: string) {
    const resolved = await this.validateBinary(binary);
    const { stdout } = await promisify(execFile)(resolved, ["version"], { timeout: 5000, maxBuffer: 4096 });
    const version = stdout.trim().split(/\r?\n/)[0];
    if (!/^bukit \S+/.test(version)) throw new Error("所选文件未返回可识别的 Bukit 版本。");
    return { path: resolved, version };
  }
  chooseEngine(binary: string) {
    return this.exclusive(async () => {
      const checked = await this.inspectEngine(binary);
      await this.saveSession({ ...this.session, binary: checked.path });
      this.binaryVersion = checked.version;
      if (this.store?.data.lastSuccessfulBuild) await this.resumePreview();
    });
  }

  private exclusive(action: () => Promise<void>, resolvingCopy = false): Promise<void> {
    if (this.busy || this.closing || (this.copy && !resolvingCopy))
      return Promise.reject(new Error("请先等待当前操作完成、取消生成或构建，或审核待确认的副本。"));
    this.busy = true;
    this.notice = null;
    this.emit();
    const pending = (async () => {
      try {
        await action();
      } catch (error) {
        this.notice = message(error);
        throw error;
      } finally {
        this.busy = false;
        this.operation = null;
        this.emit();
      }
    })();
    this.operation = pending;
    return pending;
  }

  create(directory: string, name: string) {
    return this.exclusive(async () =>
      this.activate(await ProjectStore.create(directory, name)),
    );
  }
  open(directory: string) {
    return this.exclusive(async () =>
      this.activate(await ProjectStore.open(directory)),
    );
  }
  private recentProject(id: unknown) {
    const recent = this.session.recent.find((r) => r.id === id);
    if (!recent) throw new Error("项目不在列表中，请通过“打开项目”选择目录。");
    return recent;
  }

  private async refreshRecent() {
    this.unavailable.clear();
    await Promise.all(this.session.recent.map(async (recent) => {
      try {
        if (!(await fs.lstat(recent.path)).isDirectory())
          throw new Error("请选择项目目录本身，不能使用符号链接。");
        const file = await fs.lstat(path.join(recent.path, manifestFile));
        if (!file.isFile() || file.nlink !== 1)
          throw new Error("项目文件不能使用链接或特殊文件。");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        this.unavailable.set(recent.id, code === "ENOENT" || code === "ENOTDIR"
          ? "找不到项目目录或项目文件。可重新打开或移除入口。"
          : `暂时无法打开：${message(error)}`);
      }
    }));
  }

  openRecent(id: string) {
    return this.exclusive(async () => {
      const recent = this.recentProject(id);
      try {
        await this.activate(await ProjectStore.open(recent.path));
      } catch (error) {
        await this.refreshRecent();
        throw new Error(this.unavailable.get(id) ?? message(error));
      }
    });
  }

  home() {
    return this.exclusive(async () => {
      await this.stopPreview();
      this.store = null;
      this.generation = null;
      await this.refreshRecent();
    });
  }

  private writableIndex() {
    if (!this.sessionReadable)
      throw new Error("项目列表无法读取，原索引已保留，暂时不能重命名或移除入口。");
  }

  renameProject(value: unknown) {
    return this.exclusive(async () => {
      this.writableIndex();
      const input = value as { id?: unknown; name?: unknown } | null;
      const recent = this.recentProject(input?.id), name = textField(input?.name, 60);
      const store = this.store?.root === recent.path ? this.store : await ProjectStore.open(recent.path);
      await store.save({ ...store.data, name });
      const next = { ...this.session, recent: this.session.recent.map((entry) =>
        entry.id === recent.id ? { ...entry, name } : entry) };
      try { await this.saveSession(next); }
      catch (error) {
        this.session = next;
        throw new Error(`项目名称已保存，但列表更新失败：${message(error)}`);
      }
      this.unavailable.delete(recent.id);
    });
  }

  removeProject(id: string) {
    return this.exclusive(async () => {
      this.writableIndex();
      const recent = this.recentProject(id);
      if (this.store?.root === recent.path) throw new Error("请先返回项目首页再移除入口。");
      const next = { ...this.session, recent: this.session.recent.filter((entry) => entry.id !== id) };
      if (next.lastProjectId === id) delete next.lastProjectId;
      await this.saveSession(next);
      this.unavailable.delete(id);
    });
  }

  private async activate(store: ProjectStore): Promise<void> {
    if (store.data.lastBuild?.status === "running") {
      await store.save({
        ...store.data,
        lastBuild: {
          ...store.data.lastBuild,
          status: "interrupted",
          error: "上次构建被中断。成功预览已保留，可以重新构建。",
        },
      });
    }
    await this.stopPreview();
    this.store = store;
    this.generation = null;
    const prior = this.session.recent.find((r) => r.path === store.root);
    const recent = {
      id: prior?.id ?? randomUUID(),
      path: store.root,
      name: store.data.name,
      lastOpenedAt: new Date().toISOString(),
    };
    this.session.recent = [
      recent,
      ...this.session.recent.filter((r) => r.path !== store.root),
    ].slice(0, 20);
    this.unavailable.delete(recent.id);
    this.session.lastProjectId = recent.id;
    await this.saveSession();
    await this.resumePreview();
  }

  private project(): ProjectStore {
    if (!this.store) throw new Error("请先创建或打开项目。");
    return this.store;
  }
  applyTheme() {
    return this.exclusive(async () => {
      const store = this.project();
      if (store.current().theme) return;
      await store.revise(
        newRevision(
          store.current().headline,
          sampleTheme(),
          "应用 Canopy 1.0.0 的独立副本",
        ),
      );
    });
  }
  editHeadline(headline: string) {
    return this.exclusive(async () => {
      const store = this.project(),
        current = store.current();
      const revision = newRevision(headline, current.theme, "修改首页标题");
      if (current.sourceFiles) revision.sourceFiles = { ...sourceFiles(current), "site.yaml": siteConfig(revision.headline) };
      if (revision.headline !== current.headline) await store.revise(revision);
    });
  }
  restore(id: string) {
    return this.exclusive(async () => {
      const store = this.project();
      if (!isId(id) || !store.data.revisions.some((r) => r.id === id))
        throw new Error("恢复的版本不存在。");
      await store.save({ ...store.data, currentRevisionId: id });
    });
  }

  build() {
    return this.exclusive(() => this.buildProject());
  }

  private async buildProject() {
    const store = this.project(),
      revision = structuredClone(store.current());
    if (!revision.theme) throw new Error("请先应用样例主题。");
    if (!this.session.binary)
      throw new Error("请先选择本机 Bukit 可执行文件。");
    const abort = new AbortController();
    this.abort = abort;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void this.cancel();
    }, 120_000);
    const build: BuildRecord = {
      id: randomUUID(),
      revisionId: revision.id,
      status: "running",
      startedAt: new Date().toISOString(),
      log: "",
    };
    const base = `.bukitjalil/builds/${build.id}`;
    try {
      const binary = await this.validateBinary(this.session.binary);
      await store.save({ ...store.data, lastBuild: build });
      this.emit();
      const input = await scopedPath(store.root, `${base}/input`);
      await scopedPath(store.root, `${base}/input/dist`);
      const files = sourceFiles(revision);
      for (const [filename, content] of Object.entries(files)) {
        abort.signal.throwIfAborted();
        await atomicWrite(store.root, `${base}/input/${filename}`, content);
      }
      abort.signal.throwIfAborted();
      this.buildProcess = new ManagedProcess(
        binary,
        [
          "build",
          "--config",
          path.join(input, "site.yaml"),
          "--output",
          "dist",
          "--cache-dir",
          ".cache",
          "--no-incremental",
          "--clean",
        ],
        input,
        (text) => {
          build.log = (build.log + text).slice(-64_000);
          store.data.lastBuild = { ...build };
          this.emit();
        },
      );
      const result = await this.buildProcess.done;
      abort.signal.throwIfAborted();
      if (result.error || result.code !== 0)
        throw new Error(
          result.error ??
            `Bukit 构建失败（退出码 ${result.code}）。请查看构建日志。`,
        );
      await readText(store.root, `${base}/input/dist/index.html`);
      await checkOutputTree(store.root, `${base}/input/dist`);
      build.status = "success";
      await store.save({
        ...store.data,
        lastBuild: build,
        lastSuccessfulBuild: { id: build.id, revisionId: revision.id },
      });
      try {
        await this.startPreview(build.id, revision.id, abort.signal);
      } catch (error) {
        this.notice = `构建已成功，预览未启动：${message(error)}`;
      }
    } catch (error) {
      build.status = abort.signal.aborted
        ? timedOut
          ? "failed"
          : "cancelled"
        : "failed";
      build.error = timedOut
        ? "构建超过 120 秒，已停止进程。"
        : abort.signal.aborted
          ? "构建已取消，上次成功预览未受影响。"
          : message(error);
      await store.save({ ...store.data, lastBuild: build });
      if (build.status === "failed") this.notice = build.error;
    } finally {
      clearTimeout(timeout);
      await this.buildProcess?.stop();
      this.buildProcess = null;
      this.abort = null;
    }
  }

  generate(value: unknown, codex: CodexChat) {
    return this.exclusive(async () => {
      const store = this.project();
      const input = value as { projectPath?: unknown; text?: unknown } | null;
      if (!input || input.projectPath !== store.root || typeof input.text !== "string" ||
          !input.text.trim() || input.text.length > 8000 || input.text.includes("\0"))
        throw new Error("请在当前项目输入 1–8000 字的生成要求。");
      if (!store.current().theme) throw new Error("请先应用样例主题。");
      const appRoot = await fs.realpath(this.dataDir);
      if (store.root === appRoot || store.root.startsWith(appRoot + path.sep) || appRoot.startsWith(store.root + path.sep))
        throw new Error("网站与应用数据目录必须互相独立。");
      const copy = new GenerationCopy(await store.unchanged(), sourceFiles(store.current()));
      this.copy = copy;
      const view: NonNullable<State["generation"]> = { id: copy.id, projectPath: store.root, status: "running",
        text: "", error: null, hash: null, changes: [] };
      this.generation = view;
      const abort = new AbortController(); this.abort = abort;
      // ponytail: one generation/review locks workspace mutations; per-project queues only if parallel editing is needed.
      const timeout = setTimeout(() => abort.abort(new Error("生成超过 5 分钟，已停止；未应用修改。")), 300_000);
      this.emit();
      try {
        await copy.create(appRoot);
        abort.signal.throwIfAborted();
        await codex.generate(copy, input.text.trim(), abort.signal, (text) => {
          view.text = text; this.emit();
        });
        abort.signal.throwIfAborted();
        const review = await copy.review();
        view.hash = review.hash; view.changes = review.changes; view.status = "review";
      } catch (error) {
        view.status = abort.signal.aborted ? "cancelled" : "failed";
        view.error = message(error); this.copy = null;
        await copy.remove().catch(() => { view.error += " 副本未能清理，已保留在应用数据目录。"; });
        if (!abort.signal.aborted) throw error;
      } finally {
        clearTimeout(timeout); this.abort = null; this.emit();
      }
    });
  }

  private reviewCopy(value: unknown, approving: boolean) {
    const input = value as { projectPath?: unknown; id?: unknown; hash?: unknown } | null;
    const view = this.generation, copy = this.copy;
    if (!copy || !view || view.status !== "review" || !input || input.id !== copy.id ||
        input.projectPath !== this.project().root || input.projectPath !== view.projectPath ||
        (approving && (typeof input.hash !== "string" || input.hash !== view.hash)))
      throw new Error("生成审核已失效或不属于当前项目。");
    return { copy, view };
  }

  rejectGeneration(value: unknown) {
    return this.exclusive(async () => {
      const { copy, view } = this.reviewCopy(value, false);
      this.copy = null; view.status = "rejected"; view.changes = []; view.hash = null;
      await copy.remove();
    }, true);
  }

  approveGeneration(value: unknown) {
    return this.exclusive(async () => {
      const { copy, view } = this.reviewCopy(value, true), store = this.project();
      try {
        const files = await copy.approved(view.hash!, await store.unchanged());
        if (!view.changes.length) throw new Error("副本没有源文件差异，无需应用。");
        // Recovery is durable before the single atomic manifest replacement. Source files live in that manifest.
        await atomicWrite(store.root, `.bukitjalil/recovery/${copy.id}.json`, copy.baseline);
        await copy.approved(view.hash!, await store.unchanged());
        const theme = { ...store.current().theme!, files: Object.fromEntries(themePaths.map((name) => [name, files[name]])) };
        const revision = newRevision(sourceHeadline(files), theme, "应用已审核的 AI 网站修改");
        revision.sourceFiles = files;
        await store.revise(revision);
        view.status = "applied";
      } catch (error) {
        view.status = "failed"; view.error = message(error); throw error;
      } finally {
        this.copy = null; view.hash = null;
        await copy.remove().catch(() => { this.notice = "生成副本清理失败，已保留在应用数据目录。"; });
        this.emit();
      }
      await this.buildProject();
    }, true);
  }

  async cancel(): Promise<void> {
    this.abort?.abort();
    await this.buildProcess?.stop();
  }

  private async resumePreview() {
    const successful = this.store?.data.lastSuccessfulBuild;
    if (!successful || !this.session.binary) return;
    try {
      await this.startPreview(successful.id, successful.revisionId);
    } catch (error) {
      this.notice = `成功构建记录已保留；请重新构建以恢复预览。${message(error)}`;
    }
  }

  private async startPreview(
    buildId: string,
    revisionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const store = this.project();
    const base = `.bukitjalil/builds/${buildId}`;
    const output = await scopedPath(store.root, `${base}/input/dist`);
    const input = await scopedPath(store.root, `${base}/input`);
    await checkOutputTree(store.root, `${base}/input/dist`);
    // Regenerate the safe config; never execute arbitrary project YAML on reopen.
    const revision = store.data.revisions.find((r) => r.id === revisionId)!;
    await atomicWrite(
      store.root,
      `${base}/input/site.yaml`,
      siteConfig(revision.headline),
    );
    let text = "";
    let wake: ((url: string) => void) | undefined;
    const ready = new Promise<string>((resolve) => {
      wake = resolve;
    });
    const child = new ManagedProcess(
      this.session.binary!,
      [
        "preview",
        "--dir",
        output,
        "--config",
        path.join(input, "site.yaml"),
        "--host",
        "127.0.0.1",
        "--port",
        "auto",
      ],
      input,
      (chunk) => {
        text = (text + chunk).slice(-8000);
        const match = /Preview: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(text);
        if (match) wake?.(match[1]);
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = () => {
      void child.stop();
    };
    signal?.addEventListener("abort", aborted, { once: true });
    try {
      signal?.throwIfAborted();
      const url = await Promise.race([
        ready,
        child.done.then((result) => {
          throw new Error(
            result.error ?? `预览进程退出（${result.code}）。${text}`,
          );
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("预览启动超时。")), 15_000);
        }),
      ]);
      signal?.throwIfAborted();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
      await response.body?.cancel();
      if (!response.ok || child.exited)
        throw new Error("预览服务未返回成功页面。");
      signal?.throwIfAborted();
      await this.stopPreview();
      this.previewProcess = child;
      this.preview = { url, revisionId };
      void child.done.then(() => {
        void child.stop();
        if (this.previewProcess === child) {
          this.previewProcess = null;
          this.preview = null;
          this.notice = "预览进程已退出。请重新构建以启动预览。";
          this.emit();
        }
      });
    } catch (error) {
      await child.stop();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    }
  }

  private async stopPreview(): Promise<void> {
    const child = this.previewProcess;
    this.previewProcess = null;
    this.preview = null;
    await child?.stop();
  }

  async dispose(): Promise<void> {
    this.closing = true;
    await this.cancel();
    await this.operation?.catch(() => {});
    await this.stopPreview();
    const copy = this.copy; this.copy = null;
    await copy?.remove().catch(() => {});
  }
}
