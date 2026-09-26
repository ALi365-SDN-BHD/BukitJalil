import { useRef, useState, type ReactNode } from "react";
import type { State, ChatState } from "../shared";

export function ProjectHome({ state, chat, notice, onCreate, onSettings, run }: {
  state: State | null;
  chat: ChatState | null;
  notice: ReactNode;
  onCreate: () => void;
  onSettings: () => void;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [renaming, setRenaming] = useState<State["recent"][number] | null>(null);
  const [name, setName] = useState("");
  const locked = !state || state.busy || state.generation?.status === "review";
  return <main className="project-home" aria-label="项目首页">
    <div className="project-home-content">
      {notice}
      <header className="home-heading">
        <div>
          <span className="eyebrow">BUKITJALIL / 本地项目</span>
          <h1>你的项目</h1>
          <p>选择一个项目，继续对话、编辑和预览。</p>
        </div>
        <div className="home-actions">
          <button className="secondary" onClick={onSettings}>全局设置</button>
          <button className="secondary" disabled={locked} onClick={() => run(() => window.desktop.open())}>打开项目</button>
          <button className="primary" aria-label="创建项目" disabled={locked} onClick={onCreate}>＋ 创建项目</button>
        </div>
      </header>
      <section className="project-library" aria-labelledby="recent-heading">
        <div className="library-heading"><h2 id="recent-heading">最近项目</h2><span>{state?.recent.length ?? 0} 个项目</span></div>
        {!state ? <p className="home-empty">正在读取项目列表…</p> : state.recent.length ?
          <div className="project-cards" role="list">{state.recent.map((recent) => {
            const conversation = chat?.conversations[recent.path];
            const working = ["starting", "running", "cancelling"].includes(conversation?.status ?? "");
            return <article className="project-card" role="listitem" key={recent.id}>
              <button className="project-card-open" aria-label={"打开项目 " + recent.name}
                disabled={locked} onClick={() => run(() => window.desktop.openRecent(recent.id))}>
                <span className="folder-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 7V5h6l2 2h10v13H3Z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 10h18" stroke="currentColor" /></svg></span>
                <strong className="project-card-name">{recent.name}</strong>
                <span className="project-path-label">磁盘位置</span>
                <span className="project-path">{recent.path}</span>
                <span className="project-opened"><span>最近打开</span>
                  {recent.lastOpenedAt
                    ? <time dateTime={recent.lastOpenedAt}>{new Date(recent.lastOpenedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                    : <span>尚未记录</span>}
                  <span className="project-enter" aria-hidden="true">↗</span>
                </span>
              </button>
              <details className="project-card-menu">
                <summary aria-label={"项目操作 " + recent.name} title="项目操作"><span aria-hidden="true">···</span></summary>
                <div className="project-menu-actions">
                  <button type="button" disabled={locked || !!recent.unavailable} onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setRenaming(recent); setName(recent.name); dialog.current?.showModal();
                  }}>重命名</button>
                  <button type="button" disabled={locked || working} title="只移除列表入口，保留磁盘文件"
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      void run(() => window.desktop.removeProject(recent.id));
                    }}>移除入口</button>
                </div>
              </details>
              {recent.unavailable && <p className="project-unavailable">{recent.unavailable}</p>}
              {working && <div className="home-chat-status">
                <span aria-label={recent.name + " 对话进行中"}>AI 对话进行中</span>
                <button disabled={conversation?.status !== "running"} onClick={() => run(() => window.desktop.cancelChat(recent.path))}>
                  {conversation?.status === "cancelling" ? "正在中断…" : "中断回复"}
                </button>
              </div>}
            </article>;
          })}</div>
          : <div className="home-empty"><h3>还没有项目</h3><p>创建一个新项目，或打开已有的 BukitJalil 项目目录。</p></div>}
      </section>
      <p className="home-footnote">列表保留最近打开的 20 个项目。移除入口会保留磁盘文件，可随时通过“打开项目”重新加入。</p>
    </div>
    <dialog ref={dialog} className="create-dialog" aria-labelledby="rename-heading">
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!renaming) return;
        dialog.current?.close();
        void run(() => window.desktop.renameProject({ id: renaming.id, name }));
      }}>
        <h2 id="rename-heading">重命名项目</h2>
        <label htmlFor="rename-project-name">项目显示名称</label>
        <input id="rename-project-name" autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        <p>只更新项目显示名称，目录和网站标题保持原样。</p>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>取消</button>
          <button className="primary" disabled={locked || !name.trim()}>保存名称</button>
        </div>
      </form>
    </dialog>
  </main>;
}
