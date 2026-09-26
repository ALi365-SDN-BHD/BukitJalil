import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { State, ChatState, FileChange } from "../shared";
import "./style.css";
import { ChatPanel } from "./chat";
import { ProjectHome } from "./project-home";
import { SettingsPage } from "./settings";

const labels = {
  running: "正在构建",
  success: "构建成功",
  failed: "构建失败",
  cancelled: "已取消",
  interrupted: "上次构建中断",
};
const shortTime = (date: string) =>
  new Date(date).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
const historyTime = (date: string) => new Date(date).toLocaleString("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

function App() {
  const [state, setState] = useState<State | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState("/");
  const [railTab, setRailTab] = useState<"pages" | "history">("pages");
  const [siteDraft, setSiteDraft] = useState<{ path: string; revisionId: string; title: string; description: string } | null>(null);
  const [revisionDiff, setRevisionDiff] = useState<{ fromId: string; targetId: string; changes: FileChange[] } | null>(null);
  const [logs, setLogs] = useState(false);
  const [compact, setCompact] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [projectName, setProjectName] = useState("我的第一个网站");
  const [homeScreen, setHomeScreen] = useState<"projects" | "settings">("projects");
  const createDialog = useRef<HTMLDialogElement>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const previewOpener = useRef<HTMLElement | null>(null);
  const openGenerationReview = useRef<(() => void) | null>(null);
  const revisionDialog = useRef<HTMLDialogElement>(null);
  const pagesTab = useRef<HTMLButtonElement>(null);
  const historyTab = useRef<HTMLButtonElement>(null);
  const project = state?.project;
  const current = project?.revisions.find(
    (r) => r.id === project.currentRevisionId,
  );
  const locked = !!state?.busy || state?.generation?.status === "review";
  const draft = siteDraft?.path === project?.path ? siteDraft : null;
  const siteDirty = !!draft && (draft.revisionId !== current?.id || draft.title !== current?.headline ||
    draft.description !== project?.siteDescription);
  const build = project?.lastBuild;
  const pendingPreview = state?.generation?.status === "review" ? state.draftPreview : null;
  const shownBuild = state?.generation?.status === "review" ? pendingPreview : build;
  const shownPreview = pendingPreview?.url ?? state?.preview?.url ?? null;
  const showingDraft = !!pendingPreview?.url;
  const previewRevision = project?.revisions.find(
    (r) => r.id === state?.preview?.revisionId,
  );
  const stale = !!state?.preview && state.preview.revisionId !== current?.id;

  useEffect(() => {
    if (!window.desktop) {
      setError("请通过 Electron 启动桌面应用。");
      return;
    }
    const unsubscribeChat = window.desktop.subscribeChat(setChat);
    window.desktop.chatState().then(setChat).catch((e) => setError(String(e)));
    const unsubscribe = window.desktop.subscribe(setState);
    window.desktop
      .state()
      .then(setState)
      .catch((e) => setError(String(e)));
    return () => { unsubscribe(); unsubscribeChat(); };
  }, []);
  useEffect(() => {
    setPage("/");
    setRailTab("pages");
    setSiteDraft(null);
    setRevisionDiff(null);
    revisionDialog.current?.close();
    setPreviewOpen(false);
  }, [project?.path]);
  useEffect(() => {
    if (project && !project.pages.some((entry) => entry.path === page)) setPage("/");
  }, [project?.currentRevisionId, page]);

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        (e as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    }
  }

  function showPreview(opener?: HTMLElement) {
    previewOpener.current = opener ?? null;
    setPreviewOpen(true);
    previewDialog.current?.showModal();
    return window.desktop.build();
  }

  function showRevisionDiff(revisionId: string) {
    if (!project || !current) return;
    void run(async () => {
      const changes = await window.desktop.revisionDiff({ projectPath: project.path, revisionId });
      setRevisionDiff({ fromId: current.id, targetId: revisionId, changes });
      revisionDialog.current?.showModal();
    });
  }

  const notice = (error || state?.notice) && <div className="notice" role="alert">
    <span>{error || state?.notice}</span>
    {error && <button aria-label="关闭错误提示" onClick={() => setError("")}>×</button>}
  </div>;

  return (
    <div className={`app-shell ${project ? "" : "project-home-shell"}`}>
      <header className="app-bar">
        <div className="wordmark">
          <span className="logo" aria-hidden="true">
            b.
          </span>
          <strong>BukitJalil</strong>
          <span className="local-tag">本地工作室</span>
        </div>
        <div className="project-title">
          {project ? (
            <nav aria-label="面包屑">
              <button className="breadcrumb-home" aria-label="返回项目首页" disabled={locked || siteDirty}
                title={locked || siteDirty ? "先完成当前操作，或保存、放弃未保存的网站信息。" : undefined}
                onClick={() => run(() => window.desktop.home())}>项目</button>
              <span aria-hidden="true"> / </span><span aria-current="page">{project.name}</span>
            </nav>
          ) : (
            homeScreen === "settings" ? "全局设置" : "项目首页"
          )}
        </div>
        {project && <div className="project-toolbar">
          <button className="secondary" disabled={state?.busy || !state?.generation?.hash ||
            state.generation.status !== "review" || !state.generation.changes.length || siteDirty}
            onClick={() => openGenerationReview.current?.()}>保存</button>
          <button className="primary" disabled={!!state?.busy || siteDirty || !project.themeApplied}
            title={!project.themeApplied ? "请先应用 Canopy 主题。" : siteDirty ? "请先保存或放弃网站信息修改。" : undefined}
            onClick={(event) => { void run(() => showPreview(event.currentTarget)); }}>构建预览 ↗</button>
        </div>}
      </header>

      {!project && homeScreen === "projects" && <ProjectHome state={state} chat={chat} notice={notice} run={run}
        onCreate={() => createDialog.current?.showModal()} onSettings={() => setHomeScreen("settings")} />}
      {!project && homeScreen === "settings" && <SettingsPage state={state} chat={chat}
        onBack={() => setHomeScreen("projects")} />}

      <aside className="sidebar" hidden={!project}>
        {project && <>
          <div className="sidebar-tabs" role="tablist" aria-label="项目内容" onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = railTab === "pages" ? "history" : "pages";
            setRailTab(next);
            (next === "pages" ? pagesTab : historyTab).current?.focus();
          }}>
            <button ref={pagesTab} id="pages-tab" role="tab" aria-selected={railTab === "pages"}
              aria-controls="pages-panel" tabIndex={railTab === "pages" ? 0 : -1}
              onClick={() => setRailTab("pages")}>页面 <span>{project.pages.length}</span></button>
            <button ref={historyTab} id="history-tab" role="tab" aria-selected={railTab === "history"}
              aria-controls="history-panel" tabIndex={railTab === "history" ? 0 : -1}
              onClick={() => setRailTab("history")}>历史 <span>{project.revisions.length}</span></button>
          </div>
            <div id="pages-panel" role="tabpanel" aria-labelledby="pages-tab" className="rail-section page-section" hidden={railTab !== "pages"}>
              {project.pages.map((entry) => <button key={entry.path}
                className={`page-link ${page === entry.path ? "selected" : ""}`}
                onClick={() => setPage(entry.path)}>
                <span>{entry.path === "/" ? "⌂" : "▤"}</span> {entry.title} <small>{entry.path === "/" ? "/" : entry.path.slice(0, -1)}</small>
              </button>)}
            </div>
          <div id="history-panel" role="tabpanel" aria-labelledby="history-tab" className="inspector-content history" hidden={railTab !== "history"}>
            <span className="eyebrow">可恢复版本</span>
            <h2>每一步，都留有来路。</h2>
            <p className="help">
              恢复会切换当前版本，保留所有历史。恢复后重新构建，即可查看效果。
            </p>
            {project?.revisions
              .slice()
              .reverse()
              .map((revision) => (
                <div
                  key={revision.id}
                  className={`history-entry ${current?.id === revision.id ? "current" : ""}`}
                >
                  <div className="history-top">
                    <strong>
                      版本{" "}
                      {project.revisions.findIndex(
                        (r) => r.id === revision.id,
                      ) + 1}
                    </strong>
                    <time dateTime={revision.createdAt} title={revision.createdAt}>
                      {historyTime(revision.createdAt)}
                    </time>
                  </div>
                  <h3>{revision.summary}</h3>
                  <p>{revision.headline}</p>
                  {current?.id === revision.id ? (
                    <span className="current-label">当前版本</span>
                  ) : (
                    <div className="history-actions">
                      <button className="secondary" onClick={() => showRevisionDiff(revision.id)}>查看改动</button>
                      <button disabled={locked || siteDirty} onClick={() => run(() => window.desktop.restore(revision.id))}>
                        恢复此版本 ↶
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </>}
      </aside>

      <main className="workspace" hidden={!project}>
        {notice}
        <ChatPanel state={chat} projectPath={project?.path ?? null} generation={state?.generation ?? null}
          canPreview={!!project?.themeApplied && !state?.busy && !siteDirty}
          canApply={!!state?.generation?.hash && state.generation.status === "review" &&
            !!state.generation.changes.length && !state?.busy && !siteDirty}
          onPreview={() => showPreview(document.activeElement instanceof HTMLElement ? document.activeElement : undefined)} run={run}
          reviewOpenerRef={openGenerationReview} />
      </main>

      <aside className="inspector" hidden={!project}>
        <div className="inspector-heading"><span className="eyebrow">你的网站</span><h1>网站设置</h1></div>
        {project && <>
            <div className="rail-section site-info-section">
              <h2>基本信息</h2>
              <p className="site-project-name">项目：{project.name}</p>
              <label htmlFor="site-title">网站标题</label>
              <input id="site-title" maxLength={120} value={draft?.title ?? current?.headline ?? ""}
                disabled={locked} onChange={(event) => setSiteDraft({ path: project.path,
                  revisionId: draft?.revisionId ?? current!.id, title: event.target.value,
                  description: draft?.description ?? project.siteDescription })} />
              <label htmlFor="site-description">网站简介</label>
              <input id="site-description" maxLength={300} value={draft?.description ?? project.siteDescription}
                disabled={locked} onChange={(event) => setSiteDraft({ path: project.path,
                  revisionId: draft?.revisionId ?? current!.id, title: draft?.title ?? current!.headline,
                  description: event.target.value })} />
              {siteDirty && <div className="site-info-actions">
                <button className="primary" disabled={locked || !draft?.title.trim()} onClick={() => {
                  if (!draft) return;
                  void run(async () => { await window.desktop.saveSiteInfo({ title: draft.title,
                    description: draft.description, revisionId: draft.revisionId }); setSiteDraft(null); });
                }}>保存基本信息</button>
                <button onClick={() => setSiteDraft(null)}>放弃修改</button>
              </div>}
              <button className="config-link" disabled={locked || siteDirty}
                onClick={() => run(() => window.desktop.openSiteConfig())}>高级设置 · 在默认编辑器打开 site.yaml ↗</button>
            </div>
            <div className="rail-section theme-section">
              <h2>主题选择</h2>
              <div className="theme-swatch" aria-hidden="true">
                <span>canopy</span>
                <i />
                <b />
              </div>
              <div className="theme-name">
                <strong>Canopy</strong>
                <span>1.0.0</span>
              </div>
              <p>为小小的开始，留一片空间。</p>
              <button
                className="theme-apply"
                disabled={locked || siteDirty || project.themeApplied}
                onClick={() => run(() => window.desktop.applyTheme())}
              >
                {project.themeApplied ? "✓ 已应用独立副本" : "应用样例主题"}
              </button>
              <small>修改仅属于当前项目。</small>
            </div>
        </>}
      </aside>

      <dialog ref={previewDialog} className="site-preview-dialog" aria-label="网站构建预览"
        onClose={() => { setPreviewOpen(false); previewOpener.current?.focus(); }}>
        <div className="preview-dialog-header">
          <div><span className="eyebrow">本地构建</span><h2>网站预览</h2></div>
          <button className="secondary" onClick={() => previewDialog.current?.close()}>关闭预览</button>
        </div>
        {project && <>
          {shownBuild?.status === "running" && <div className="preview-progress" role="status">
            <span>{state?.generation?.status === "review" ? "正在构建待确认副本…" : "正在构建当前版本…"}</span>
            <button className="secondary" onClick={() => run(() => window.desktop.cancel())}>取消构建</button>
          </div>}
          {shownBuild?.status === "failed" && <p className="preview-error" role="alert">构建失败：{shownBuild.error ?? "请查看构建日志。"}</p>}
          {shownBuild?.status === "cancelled" && <p className="preview-error" role="status">构建已取消，仍显示上次成功预览。</p>}
          {error && <p className="preview-error" role="alert">{error}</p>}
            <div
              className={`preview-status ${!showingDraft && stale ? "stale" : ""}`}
              aria-live="polite"
            >
              <span
                className={`status-dot ${shownPreview && (showingDraft || !stale) ? "ready" : ""}`}
              />
              <span>
                {showingDraft
                  ? pendingPreview?.status === "success" ? "待确认修改预览 · 尚未保存到正式项目"
                    : "待确认副本正在构建 · 显示上次成功副本预览"
                  : state?.generation?.status === "review"
                    ? shownPreview ? "显示正式网站上次成功预览 · 待确认副本尚未成功构建" : "待确认副本尚未成功构建"
                    : state?.preview
                      ? stale ? "显示上次成功预览 · 当前版本尚未构建成功" : "当前正式版本已构建 · 正在预览本地网站"
                      : project.themeApplied ? "主题已就绪，点击“构建预览”查看网站。" : "先从左侧应用 Canopy 样例主题。"}
              </span>
            </div>
          {previewOpen && (
            <div id="site-preview" className="preview-stage">
              <div className={`browser-frame ${compact ? "compact" : ""}`}>
                <div className="browser-chrome">
                  <div className="browser-dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span className="address">
                    {shownPreview ? `${showingDraft ? "待确认副本" : "正式版本"} · 本地预览 ${page}` : "等待首次构建"}
                  </span>
                  <button
                    aria-label={compact ? "切换桌面宽度" : "切换窄屏宽度"}
                    title={compact ? "桌面宽度" : "窄屏宽度"}
                    onClick={() => setCompact(!compact)}
                  >
                    {compact ? "▭" : "▯"}
                  </button>
                </div>
                {shownPreview ? (
                  <iframe
                    title="网站预览"
                    key={shownPreview}
                    src={`${shownPreview}${page.slice(1)}`}
                    sandbox=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="preview-empty">
                    <div className="seed-mark" aria-hidden="true">
                      ↗
                    </div>
                    <h2>你的网站，即将在这里生长。</h2>
                    <p>
                      应用一个主题，交给 Bukit 构建。
                      <br />
                      每一次成功，都有一个可以回来的版本。
                    </p>
                    <div className="steps">
                      <span className="done">1 创建项目</span>
                      <span className={project.themeApplied ? "done" : ""}>
                        2 应用主题
                      </span>
                      <span>3 构建预览</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
            <div className="build-strip">
              <button
                className="log-toggle"
                aria-expanded={logs}
                onClick={() => setLogs(!logs)}
              >
                <span>{logs ? "⌄" : "›"}</span> 构建日志{" "}
                {shownBuild && (
                  <span className={`build-label ${shownBuild.status}`}>
                    {labels[shownBuild.status]}
                  </span>
                )}
              </button>
              <span>
                {showingDraft ? "待确认修改副本 · 未保存" : state?.preview && previewRevision
                  ? `预览版本 ${project.revisions.findIndex((r) => r.id === previewRevision.id) + 1} · ${shortTime(previewRevision.createdAt)}`
                  : "本地构建 · 无需发布"}
              </span>
            </div>
            {logs && (
              <section className="log-panel" aria-label="构建日志">
                <pre>
                  {shownBuild?.log || "还没有构建日志。"}
                  {shownBuild?.error && `\n${shownBuild.error}`}
                </pre>
              </section>
            )}
        </>}
      </dialog>

      <dialog ref={revisionDialog} className="generation-review revision-review" aria-label="查看版本改动"
        onClose={() => setRevisionDiff(null)}>
        <h2>恢复前查看改动</h2>
        <p>以下内容从当前版本 → 所选历史版本；恢复后网站源文件会变为右侧内容。</p>
        {revisionDiff && project?.currentRevisionId === revisionDiff.fromId && <>
          <p>目标：版本 {project.revisions.findIndex((revision) => revision.id === revisionDiff.targetId) + 1}
            {revisionDiff.changes.length ? ` · ${revisionDiff.changes.length} 个文件有差异` : " · 文件无差异"}</p>
          {revisionDiff.changes.map((file) => <details key={file.path} className="file-change" open={revisionDiff.changes.length === 1}>
            <summary>{{ added: "新增", modified: "修改", deleted: "删除" }[file.kind]} · {file.path}</summary>
            <div className="file-diff">
              <div><h3>当前版本</h3><pre>{file.before ?? "（文件不存在）"}</pre></div>
              <div><h3>恢复后</h3><pre>{file.after ?? "（文件不存在）"}</pre></div>
            </div>
          </details>)}
        </>}
        <div className="dialog-actions"><button className="secondary" onClick={() => revisionDialog.current?.close()}>关闭</button></div>
      </dialog>

      <dialog ref={createDialog} className="create-dialog">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createDialog.current?.close();
            void run(() => window.desktop.create(projectName));
          }}
        >
          <span className="eyebrow">新的开始</span>
          <h2>给项目起个名字。</h2>
          <label htmlFor="project-name">项目名称</label>
          <input
            id="project-name"
            autoFocus
            maxLength={60}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <p>下一步选择保存位置。每个项目使用一个新的独立目录。</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => createDialog.current?.close()}
            >
              取消
            </button>
            <button className="primary" disabled={!projectName.trim()}>
              选择位置并创建
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
