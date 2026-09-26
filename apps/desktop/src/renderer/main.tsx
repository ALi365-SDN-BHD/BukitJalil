import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { State, ChatState } from "../shared";
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

function App() {
  const [state, setState] = useState<State | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [error, setError] = useState("");
  const [headline, setHeadline] = useState("");
  const [page, setPage] = useState("/");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [logs, setLogs] = useState(false);
  const [compact, setCompact] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [projectName, setProjectName] = useState("我的第一个网站");
  const [homeScreen, setHomeScreen] = useState<"projects" | "settings">("projects");
  const createDialog = useRef<HTMLDialogElement>(null);
  const project = state?.project;
  const current = project?.revisions.find(
    (r) => r.id === project.currentRevisionId,
  );
  const draft = !!current && headline !== current.headline;
  const locked = !!state?.busy || state?.generation?.status === "review";
  const build = project?.lastBuild;
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
    setHeadline(current?.headline ?? "");
  }, [current?.id]);
  useEffect(() => {
    setPage("/");
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

  const notice = (error || state?.notice) && <div className="notice" role="alert">
    <span>{error || state?.notice}</span>
    {error && <button aria-label="关闭错误提示" onClick={() => setError("")}>×</button>}
  </div>;

  return (
    <div className={`app-shell ${project ? previewOpen ? "preview-open" : "" : "project-home-shell"}`}>
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
            <>
              <span className="muted">项目 / </span>
              {project.name}
            </>
          ) : (
            homeScreen === "settings" ? "全局设置" : "项目首页"
          )}
        </div>
        <button
          className="engine-button"
          title={state?.binary ?? "选择本机的 Bukit 可执行文件"}
          disabled={locked}
          onClick={() => run(() => window.desktop.chooseEngine())}
        >
          <span className={`status-dot ${state?.binary ? "ready" : ""}`} />
          {state?.binary ? "Bukit 已连接" : "选择 Bukit 引擎"}
          <span>⌄</span>
        </button>
      </header>

      {!project && homeScreen === "projects" && <ProjectHome state={state} chat={chat} notice={notice} run={run}
        onCreate={() => createDialog.current?.showModal()} onSettings={() => setHomeScreen("settings")} />}
      {!project && homeScreen === "settings" && <SettingsPage state={state} chat={chat}
        onBack={() => setHomeScreen("projects")} />}

      <aside className="sidebar" hidden={!project}>
        {project && <>
            <div className="rail-section page-section">
              <h2>页面 <span>{project.pages.length}</span></h2>
              {project.pages.map((entry) => <button key={entry.path}
                className={`page-link ${page === entry.path ? "selected" : ""}`}
                onClick={() => setPage(entry.path)}>
                <span>{entry.path === "/" ? "⌂" : "▤"}</span> {entry.title} <small>{entry.path === "/" ? "/" : entry.path.slice(0, -1)}</small>
              </button>)}
            </div>
          <button className="preview-toggle secondary" aria-expanded={previewOpen}
            onClick={() => setPreviewOpen(!previewOpen)}>
            {previewOpen ? "关闭预览" : "展开预览"}
          </button>
          <div className="build-actions">
            {locked && build?.status === "running" ? (
              <button className="secondary" onClick={() => run(() => window.desktop.cancel())}>取消构建</button>
            ) : <span className="save-state">{draft ? "有未保存的修改" : "版本已保存在本地"}</span>}
            <button className="primary" disabled={locked || !project.themeApplied || !state?.binary || draft}
              onClick={() => run(() => window.desktop.build())}>
              {locked && build?.status === "running" ? "构建中…" : "构建预览"} <span>↗</span>
            </button>
          </div>
            <div
              className={`preview-status ${stale ? "stale" : ""}`}
              aria-live="polite"
            >
              <span
                className={`status-dot ${state?.preview && !stale ? "ready" : ""}`}
              />
              <span>
                {state?.preview
                  ? stale
                    ? "显示上次成功预览 · 当前版本尚未构建成功"
                    : previewOpen ? "当前版本已构建 · 正在预览本地网站" : "当前版本已构建 · 可展开预览"
                  : project.themeApplied
                    ? "主题已就绪，点击“构建预览”查看网站。"
                    : "先从左侧应用 Canopy 样例主题。"}
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
                    {state?.preview ? `本地预览 ${page}` : "等待首次构建"}
                  </span>
                  <button
                    aria-label={compact ? "切换桌面宽度" : "切换窄屏宽度"}
                    title={compact ? "桌面宽度" : "窄屏宽度"}
                    onClick={() => setCompact(!compact)}
                  >
                    {compact ? "▭" : "▯"}
                  </button>
                </div>
                {state?.preview ? (
                  <iframe
                    title="网站预览"
                    key={state.preview.url}
                    src={`${state.preview.url}${page.slice(1)}`}
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
                {build && (
                  <span className={`build-label ${build.status}`}>
                    {labels[build.status]}
                  </span>
                )}
              </button>
              <span>
                {state?.preview && previewRevision
                  ? `预览版本 ${project.revisions.findIndex((r) => r.id === previewRevision.id) + 1} · ${shortTime(previewRevision.createdAt)}`
                  : "本地构建 · 无需发布"}
              </span>
            </div>
            {logs && (
              <section className="log-panel" aria-label="构建日志">
                <pre>
                  {build?.log || "还没有构建日志。"}
                  {build?.error && `\n${build.error}`}
                </pre>
              </section>
            )}
        </>}
      </aside>

      <main className="workspace" hidden={!project}>
        {notice}
        <ChatPanel state={chat} projectPath={project?.path ?? null} generation={state?.generation ?? null}
          canGenerate={!!project?.themeApplied && !locked && !draft} run={run} />
      </main>

      <aside className="inspector" hidden={!project}>
        <button className="return-home secondary" aria-label="返回项目首页"
          disabled={locked || draft} onClick={() => run(() => window.desktop.home())}>
          ← 项目首页
        </button>
        {(locked || draft) && <p className="rail-empty">{draft
          ? "保存或放弃未保存的修改后，可返回项目首页。"
          : "结束当前操作或处理待审核修改后，可返回项目首页。"}</p>}
        <div className="inspector-heading"><span className="eyebrow">你的网站</span><h1>网站设置</h1></div>
        {project && <>
            <div className="rail-section theme-section">
              <h2>主题</h2>
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
                disabled={locked || !project || project.themeApplied}
                onClick={() => run(() => window.desktop.applyTheme())}
              >
                {project.themeApplied ? "✓ 已应用独立副本" : "应用样例主题"}
              </button>
              <small>修改仅属于当前项目。</small>
            </div>
        </>}
        <div className="inspector-tabs" role="tablist" aria-label="网站设置">
          <button role="tab" aria-selected={tab === "edit"} onClick={() => setTab("edit")}>编辑</button>
          <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
            历史{project && <span>{project.revisions.length}</span>}
          </button>
        </div>
        {tab === "edit" ? (
          <div className="inspector-content">
            <span className="eyebrow">页面内容</span>
            <h2>一句话，介绍你自己。</h2>
            <p className="help">
              从首页标题开始。保存修改后，构建预览查看实际效果。
            </p>
            {project ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => window.desktop.editHeadline(headline));
                }}
              >
                <label htmlFor="headline">
                  首页标题 <span>{headline.length}/120</span>
                </label>
                <textarea
                  id="headline"
                  rows={4}
                  maxLength={120}
                  value={headline}
                  disabled={locked}
                  onChange={(e) =>
                    setHeadline(e.target.value.replace(/[\r\n]/g, ""))
                  }
                />
                <div className="change-summary">
                  <strong>变更摘要</strong>
                  {draft ? (
                    <>
                      <p className="before">− {current?.headline}</p>
                      <p className="after">
                        ＋ {headline || "（标题不能为空）"}
                      </p>
                    </>
                  ) : (
                    <p>暂时没有待保存的修改。</p>
                  )}
                </div>
                <button
                  type="submit"
                  className="primary full-width"
                  disabled={locked || !draft || !headline.trim()}
                >
                  保存为新版本
                </button>
                {draft && (
                  <button
                    type="button"
                    className="text-button full-width"
                    onClick={() => setHeadline(current!.headline)}
                  >
                    放弃未保存的修改
                  </button>
                )}
                <p className="save-help">
                  保存后可在“历史”中恢复。构建成功前，已有预览会继续保留。
                </p>
              </form>
            ) : (
              <div className="inspector-placeholder">
                创建或打开项目后，在这里编辑首页标题。
              </div>
            )}
            <div className="conversation-note">
              <span>✳</span>
              <div>
                <strong>对话工作区</strong>
                <p>
                  在中间对话区讨论当前网站与主题。
                  <br />
                  由你确认编辑，由 Bukit 构建。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="inspector-content history">
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
                    <time title={revision.createdAt}>
                      {shortTime(revision.createdAt)}
                    </time>
                  </div>
                  <h3>{revision.summary}</h3>
                  <p>{revision.headline}</p>
                  {current?.id === revision.id ? (
                    <span className="current-label">当前版本</span>
                  ) : (
                    <button
                      disabled={locked || draft}
                      onClick={() =>
                        run(() => window.desktop.restore(revision.id))
                      }
                    >
                      恢复此版本 ↶
                    </button>
                  )}
                </div>
              ))}
            {!project && (
              <p className="help">保存第一次修改后，历史会出现在这里。</p>
            )}
          </div>
        )}
        <div className="inspector-footer">
          LOCAL FIRST <span>·</span> YOUR WORK, YOUR FILES
        </div>
      </aside>

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
