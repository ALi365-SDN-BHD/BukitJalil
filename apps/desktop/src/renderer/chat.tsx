import { useEffect, useRef, useState } from "react";
import type { ChatState } from "../shared";

const statusLabels = {
  idle: "准备就绪", starting: "正在确认请求", running: "正在回复", cancelling: "正在中断",
  completed: "本轮完成", interrupted: "已中断", failed: "本轮失败", unknown: "需要核对会话状态",
};
export function ChatPanel({ state, projectPath, run }: {
  state: ChatState | null;
  projectPath: string | null;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const log = useRef<HTMLDivElement>(null);
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
      <p>讨论当前网站、内容与主题。回复是建议，网站文件保持不变。</p>
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
        <small>发送后使用你的 Codex 账户额度</small>
        {working ? <button type="button" className="secondary"
          disabled={chat.status !== "running"}
          onClick={() => run(() => window.desktop.cancelChat(projectPath!))}>
          {chat.status === "cancelling" ? "正在中断…" : "中断回复"}
        </button> : <button className="primary"
          disabled={!projectPath || !ready || !state.account || !draft.trim() || chat?.status === "unknown"}>
          发送
        </button>}
      </div>
    </form>
  </section>;
}
