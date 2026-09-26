import { useEffect, useRef, useState } from "react";
import type { ChatState, GenerationState } from "../shared";

const statusLabels = {
  idle: "准备就绪", starting: "正在确认请求", running: "正在回复", cancelling: "正在中断",
  completed: "本轮完成", interrupted: "已中断", failed: "本轮失败", unknown: "需要核对会话状态",
};
export function ChatPanel({ state, projectPath, generation, canGenerate, run }: {
  state: ChatState | null;
  projectPath: string | null;
  generation: GenerationState | null;
  canGenerate: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const log = useRef<HTMLDivElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const generated = generation?.projectPath === projectPath ? generation : null;
  const chat = projectPath ? state?.conversations[projectPath] : undefined;
  const draft = projectPath ? drafts[projectPath] ?? "" : "";
  const ready = state?.connection === "ready";
  const working = chat && ["starting", "running", "cancelling"].includes(chat.status);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [projectPath, chat?.messages]);
  return <section className="chat-panel" aria-label="网站对话">
    <div className="chat-heading">
      <h2>一起想清楚，再动手。</h2>
      <p>发送用于只读讨论；点击“生成修改”后先审核副本，再决定是否应用。</p>
      <div className="chat-account">
        <strong>{ready ? state.account
          ? "Codex · " + (state.account.type === "chatgpt" ? "ChatGPT 已登录" : "API 账户已连接")
          : "Codex · 尚未登录"
          : state?.connection === "connecting" ? "正在连接 Codex…" : "Codex 尚未连接"}</strong>
        <small>{state?.version ?? "正在检测本机 Codex"}</small>
      </div>
      {(!ready || chat?.status === "unknown") && <button
        className="secondary" disabled={state?.connection === "connecting"}
        onClick={() => run(() => window.desktop.connectChat())}>
        {chat?.status === "unknown" ? "核对并恢复会话" : "连接 Codex"}
      </button>}
      {ready && !state.account && !state.loginPending && <button
        className="primary" onClick={() => run(() => window.desktop.loginChat())}>
        在官方页面登录
      </button>}
      {state?.loginPending && <div className="chat-login">
        <p>已打开官方登录页面，完成后会自动更新。</p>
        <button onClick={() => run(() => window.desktop.cancelLoginChat())}>取消登录</button>
      </div>}
      {(state?.error || chat?.error) && <p className="chat-error" role="alert">{state?.error || chat?.error}</p>}
    </div>
    <div className="chat-messages" ref={log} role="log" aria-label="当前项目对话" aria-live="polite" aria-relevant="additions text">
      {!chat?.messages.length && <p className="chat-empty">{projectPath
        ? "可以从“首页应该突出什么？”开始。"
        : "创建或打开项目后，开始讨论你的网站。"}</p>}
      {chat?.messages.map((message) => <article className={"chat-message " + message.role} key={message.id}>
        <strong>{message.role === "user" ? "你" : "Codex"}</strong>
        <p>{message.text}</p>
      </article>)}
    </div>
    {generated && <div className="generation-status" role="status">
      <strong>{{ running: "正在生成副本", review: "副本已就绪 · 等待审核", applied: "修改已应用", rejected: "已拒绝修改", cancelled: "生成已取消", failed: "生成失败 · 未应用" }[generated.status]}</strong>
      {generated.error && <p role="alert">{generated.error}</p>}
      {generated.status === "running" && <button className="secondary" onClick={() => run(() => window.desktop.cancel())}>取消生成</button>}
      {generated.status === "review" && <button className="primary" onClick={() => reviewDialog.current?.showModal()}>审核 {generated.changes.length} 个文件差异</button>}
    </div>}
    <dialog ref={reviewDialog} className="generation-review" aria-label="审核生成修改">
      <h2>审核生成修改</h2>
      <p>以下差异由应用读取副本文件得到。确认后保存为新版本并构建；现在正式项目尚未修改。</p>
      {generated?.text && <details><summary>Codex 说明</summary><pre>{generated.text}</pre></details>}
      {!generated?.changes.length && <p>没有文件差异，无需应用。</p>}
      {generated?.changes.map((file) => <details key={file.path} className="file-change" open={generated.changes.length === 1}>
        <summary>{{ added: "新增", modified: "修改", deleted: "删除" }[file.kind]} · {file.path}</summary>
        <div className="file-diff">
          <div><h3>修改前</h3><pre>{file.before ?? "（文件不存在）"}</pre></div>
          <div><h3>修改后</h3><pre>{file.after ?? "（文件已删除）"}</pre></div>
        </div>
      </details>)}
      <div className="dialog-actions">
        <button onClick={() => reviewDialog.current?.close()}>稍后审核</button>
        <button className="secondary" onClick={() => {
          if (!generated || !projectPath) return;
          void run(() => window.desktop.rejectGeneration({ projectPath, id: generated.id }));
          reviewDialog.current?.close();
        }}>拒绝修改</button>
        <button className="primary" disabled={!generated?.hash || !generated.changes.length} onClick={() => {
          if (!generated?.hash || !projectPath) return;
          void run(() => window.desktop.approveGeneration({ projectPath, id: generated.id, hash: generated.hash! }));
          reviewDialog.current?.close();
        }}>确认应用并构建</button>
      </div>
    </dialog>
    <form className="chat-compose" onSubmit={(event) => {
      event.preventDefault();
      if (!projectPath) return;
      const selected = projectPath, text = draft;
      void run(async () => {
        await window.desktop.sendChat({ projectPath: selected, text });
        setDrafts((prior) => ({ ...prior, [selected]: "" }));
      });
    }}>
      <div className="chat-turn-status" role="status">{chat ? statusLabels[chat.status] : "每个项目保留一段独立对话"}</div>
      <label htmlFor="chat-message">讨论你的网站</label>
      <textarea id="chat-message" rows={3} maxLength={8000} value={draft}
        placeholder="说说你想改善的内容…"
        disabled={!projectPath}
        onChange={(event) => {
          if (projectPath) setDrafts((prior) => ({ ...prior, [projectPath]: event.target.value }));
        }} />
      <div className="chat-actions">
        <small>发送或生成会使用 Codex 账户额度</small>
        {working ? <button type="button" className="secondary"
          disabled={chat.status !== "running"}
          onClick={() => run(() => window.desktop.cancelChat(projectPath!))}>
          {chat.status === "cancelling" ? "正在中断…" : "中断回复"}
        </button> : <button className="primary"
          disabled={!projectPath || !ready || !state.account || !draft.trim() || chat?.status === "unknown"}>
          发送
        </button>}
      </div>
      <button type="button" className="secondary full-width" disabled={!canGenerate || !ready || !state?.account || !draft.trim() || !!working || chat?.status === "unknown"}
        onClick={() => {
          if (!projectPath) return;
          const selected = projectPath, text = draft;
          void run(async () => {
            await window.desktop.generate({ projectPath: selected, text });
            setDrafts((prior) => ({ ...prior, [selected]: "" }));
          });
        }}>生成修改 · 先审核副本</button>
    </form>
  </section>;
}
