import { useEffect, useRef, useState } from "react";
import type { ChatState, GenerationState } from "../shared";

function chatCommand(text: string) {
  const input = text.trim();
  if (/^(?:请)?预览一下[。！!]?$/.test(input)) return "preview";
  if (/^(?:请)?保存这些修改[。！!]?$/.test(input)) return "save";
  return null;
}
export function ChatPanel({ state, projectPath, generation, canPreview, canApply, onPreview, run, reviewOpenerRef }: {
  state: ChatState | null;
  projectPath: string | null;
  generation: GenerationState | null;
  canPreview: boolean;
  canApply: boolean;
  onPreview: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  reviewOpenerRef: { current: (() => void) | null };
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const log = useRef<HTMLDivElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const stopRequested = useRef(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [displayStatus, setDisplayStatus] = useState("");
  const generated = generation?.projectPath === projectPath ? generation : null;
  const chat = projectPath ? state?.conversations[projectPath] : undefined;
  const draft = projectPath ? drafts[projectPath] ?? "" : "";
  const command = chatCommand(draft);
  const ready = state?.connection === "ready";
  const working = chat && ["starting", "running", "cancelling"].includes(chat.status);
  const stoppingCurrent = stopping === projectPath && !!projectPath;
  const stoppingNow = stoppingCurrent || chat?.status === "cancelling";
  const statusText = stoppingNow ? "正在停止" : generated?.status === "running" ? "正在生成修改" : working
    ? chat.phase === "generation" ? "正在生成修改" : chat.phase === "reply" ? "正在回复" : "正在处理"
    : generated?.status === "failed" ? "生成失败" : chat?.status === "failed" ? "回复失败"
      : chat?.status === "unknown" ? "需核对会话" : "";
  const showStop = generated?.status === "running" || chat?.status === "running" || stoppingNow;
  const canSubmit = !!projectPath && !!draft.trim() && !working && chat?.status !== "unknown" &&
    (!!command || (!!ready && !!state?.account));
  useEffect(() => {
    if (statusText) { setDisplayStatus(statusText); return; }
    const timeout = window.setTimeout(() => setDisplayStatus(""), 160);
    return () => window.clearTimeout(timeout);
  }, [statusText]);
  useEffect(() => {
    if (stopping && (stopping !== projectPath || (!working && generated?.status !== "running"))) {
      stopRequested.current = false;
      setStopping(null);
    }
  }, [stopping, projectPath, generated?.status, working]);
  function stop() {
    if (!projectPath || stopRequested.current) return;
    const kind = generated?.status === "running" ? "generation" : "chat";
    const selected = projectPath;
    stopRequested.current = true;
    setStopping(selected);
    let failed = false;
    void run(async () => {
      try {
        if (kind === "generation") await window.desktop.cancel();
        else await window.desktop.cancelChat(selected);
      } catch (error) { failed = true; throw error; }
    }).then(() => {
      if (failed) { stopRequested.current = false; setStopping(null); }
    });
  }
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [projectPath, chat?.messages]);
  useEffect(() => {
    reviewOpenerRef.current = () => reviewDialog.current?.showModal();
    return () => { reviewOpenerRef.current = null; };
  }, [reviewOpenerRef]);
  return <section className="chat-panel" aria-label="网站对话">
    <div className="chat-connection">
        <strong>{ready ? state.account
          ? "Codex · " + (state.account.type === "chatgpt" ? "ChatGPT 已登录" : "API 账户已连接")
          : "Codex · 尚未登录"
          : state?.connection === "connecting" ? "正在连接 Codex…" : "Codex 尚未连接"}</strong>
      {(!ready || chat?.status === "unknown") && <button
        className="secondary status-action" disabled={state?.connection === "connecting"}
        onClick={() => run(() => window.desktop.connectChat())}>
        {chat?.status === "unknown" ? "核对并恢复会话" : "连接 Codex"}
      </button>}
      {ready && !state.account && !state.loginPending && <button
        className="primary status-action" onClick={() => run(() => window.desktop.loginChat())}>
        在官方页面登录
      </button>}
      {state?.loginPending && <div className="chat-login">
        <p>已打开官方登录页面，完成后会自动更新。</p>
        <button className="secondary status-action" onClick={() => run(() => window.desktop.cancelLoginChat())}>取消登录</button>
      </div>}
      {(state?.error || chat?.error) && <p className="chat-error" role="alert">{state?.error || chat?.error}</p>}
    </div>
    <div className="chat-messages" ref={log} role="log" aria-label="当前项目对话" aria-live="polite" aria-relevant="additions">
      {chat?.messages.map((message) => <article className={"chat-message " + message.role} key={message.id}>
        <strong>{message.role === "user" ? "你" : "Codex"}</strong>
        <p>{message.text}</p>
      </article>)}
    </div>
    {generated && generated.status !== "running" && <div className="generation-status" role="status">
      <strong>{{ running: "正在生成副本", review: "副本已就绪 · 等待审核", applied: "修改已应用", rejected: "已拒绝修改", cancelled: "生成已取消", failed: "生成失败 · 未应用" }[generated.status]}</strong>
      {generated.error && <p role="alert">{generated.error}</p>}
      {generated.status === "review" && <button className="primary status-action" onClick={() => reviewDialog.current?.showModal()}>审核 {generated.changes.length} 个文件差异</button>}
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
      if (!projectPath || !canSubmit || submitting.current) return;
      const selected = projectPath, text = draft, action = command;
      submitting.current = true;
      void run(async () => {
        if (action === "preview") {
          if (!canPreview) throw new Error("请先完成当前操作、保存网站信息并应用主题，再构建预览。");
          await onPreview();
        } else if (action === "save") {
          if (!canApply || !generated?.hash || generated.status !== "review")
            throw new Error("当前没有可保存的待审核修改，或需先完成当前操作。");
          await window.desktop.approveGeneration({ projectPath: selected, id: generated.id, hash: generated.hash });
        } else {
          await window.desktop.sendChat({ projectPath: selected, text });
        }
        setDrafts((prior) => prior[selected] === text ? { ...prior, [selected]: "" } : prior);
      }).finally(() => { submitting.current = false; });
    }}>
      <div className="chat-compose-head">
        <small className="chat-input-hint">Enter 发送 · Shift+Enter 换行</small>
        {displayStatus && <span className={"chat-turn-status" + (statusText ? " visible" : "") + (!working && !stoppingNow ? " error" : "")}
          role="status" aria-live="polite" aria-atomic="true" aria-hidden={!statusText || (!working && !stoppingNow)}>{displayStatus}</span>}
      </div>
      <div className="chat-input-row">
        <textarea id="chat-message" aria-label="讨论你的网站" rows={3} maxLength={8000} value={draft}
          placeholder="提问、描述要修改的网站内容，或输入“预览一下”“保存这些修改”…"
          disabled={!projectPath}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            if (canSubmit && !submitting.current) event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => {
            if (projectPath) setDrafts((prior) => ({ ...prior, [projectPath]: event.target.value }));
          }} />
        {showStop && <button type="button" className="chat-stop" title={stoppingNow ? "正在停止" : "停止"}
          aria-label={stoppingNow ? "正在停止" : "停止"} disabled={!!stoppingNow} onClick={stop}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
        </button>}
      </div>
      {generated?.status === "review" &&
        <small className="chat-mode-hint">修改副本待审核；可继续提问，新的修改需先审核或拒绝当前副本。</small>}
      <div className="chat-actions">
        <small>讨论或修改会使用 Codex 账户额度</small>
      </div>
    </form>
  </section>;
}
