import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { State, RecentProject, BuildRecord } from "../shared";
import { ProjectStore, newRevision, isId } from "./project";
import { atomicWrite, readText, scopedPath, checkOutputTree } from "./files";
import { aboutPage, sampleTheme, siteConfig } from "./theme";
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
                ({ theme: _theme, ...revision }) => revision,
              ),
              themeApplied: !!this.store.current().theme,
            }
          : null,
      recent: structuredClone(this.session.recent),
      binary: this.session.binary,
      busy: this.busy,
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
        files: {
          "site.yaml": siteConfig(revision.headline),
          "content/about.md": aboutPage,
          ...(revision.theme?.files ?? {}),
        },
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
            typeof r.name !== "string",
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
        this.session.binary = await this.validateBinary(binary);
      } catch (error) {
        this.notice = message(error);
      }
    }
    const recent = this.session.recent.find(
      (r) => r.id === this.session.lastProjectId,
    );
    if (recent) {
      try {
        await this.open(recent.path);
      } catch (error) {
        this.notice = `无法恢复最近项目：${message(error)}`;
      }
    }
    this.emit();
  }

  private async saveSession(): Promise<void> {
    if (this.sessionReadable)
      await atomicWrite(
        this.dataDir,
        "session.json",
        JSON.stringify(this.session, null, 2) + "\n",
      );
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
  chooseEngine(binary: string) {
    return this.exclusive(async () => {
      this.session.binary = await this.validateBinary(binary);
      await this.saveSession();
      if (this.store?.data.lastSuccessfulBuild) await this.resumePreview();
    });
  }

  private exclusive(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.closing)
      return Promise.reject(new Error("请先等待当前操作完成，或取消构建。"));
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
  openRecent(id: string) {
    const recent = this.session.recent.find((r) => r.id === id);
    if (!recent)
      return Promise.reject(
        new Error("最近项目不存在，请通过“打开项目”选择目录。"),
      );
    return this.open(recent.path);
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
    const prior = this.session.recent.find((r) => r.path === store.root);
    const recent = {
      id: prior?.id ?? randomUUID(),
      path: store.root,
      name: store.data.name,
    };
    this.session.recent = [
      recent,
      ...this.session.recent.filter((r) => r.path !== store.root),
    ].slice(0, 20);
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
    return this.exclusive(async () => {
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
        const files = {
          "site.yaml": siteConfig(revision.headline),
          "content/about.md": aboutPage,
          ...revision.theme.files,
        };
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
    });
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
  }
}
