import { useEffect, useState } from "react";
import type { ChatState, State } from "../shared";

export function SettingsPage({ state, chat, onBack }: {
  state: State | null;
  chat: ChatState | null;
  onBack: () => void;
}) {
  const [bukitPath, setBukitPath] = useState("");
  const [codexPath, setCodexPath] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setBukitPath(state?.binary ?? ""), [state?.binary]);
  useEffect(() => setCodexPath(chat?.binary ?? ""), [chat?.binary]);
  useEffect(() => { setModel(chat?.model ?? ""); setEffort(chat?.effort ?? ""); }, [chat?.model, chat?.effort]);
  const locked = working || !state || !chat || state.busy || state.generation?.status === "review" ||
    chat.connection === "connecting" || chat.loginPending ||
    Object.values(chat.conversations).some((item) => ["starting", "running", "cancelling", "unknown"].includes(item.status));
  const selected = chat?.models.find((item) => item.id === model);

  async function perform(action: () => Promise<void>, success: string) {
    setWorking(true); setError(""); setFeedback("");
    try { await action(); setFeedback(success); }
    catch (cause) {
      setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
    } finally { setWorking(false); }
  }
  async function browse(engine: "Bukit" | "Codex") {
    try {
      const picked = await window.desktop.pickExecutable(engine);
      if (picked) {
        if (engine === "Bukit") setBukitPath(picked); else setCodexPath(picked);
        setFeedback(""); setError("");
      }
    } catch (cause) { setError(String(cause)); }
  }

  return <main className="settings-page" aria-label="全局设置">
    <div className="settings-content">
      <button className="settings-back" onClick={onBack} disabled={working}>← 项目首页</button>
      <header className="settings-heading">
        <span className="eyebrow">BUKITJALIL / 应用偏好</span>
        <h1>全局设置</h1>
        <p>选择这台 Mac 上的构建与 AI 程序。设置只保存在 BukitJalil 中，不会修改网站或 Codex 的全局配置。</p>
      </header>
      {(error || feedback) && <p className={`settings-feedback ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || feedback}</p>}
      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="bukit-settings-heading">
          <div className="settings-card-top"><span className="settings-icon">↗</span><span className={`settings-chip ${state?.binaryVersion ? "ready" : ""}`}>{state?.binaryVersion ? "已检测" : "待检测"}</span></div>
          <h2 id="bukit-settings-heading">Bukit 构建引擎</h2>
          <p>负责在本机构建和预览网站。</p>
          <dl className="settings-facts"><div><dt>检测版本</dt><dd>{state?.binaryVersion ?? "尚未检测到可用版本"}</dd></div></dl>
          <form onSubmit={(event) => { event.preventDefault(); void perform(() => window.desktop.saveBukitPath(bukitPath.trim()), "Bukit 路径已保存并生效。"); }}>
            <label htmlFor="bukit-executable">可执行文件路径</label>
            <div className="settings-path-row"><input id="bukit-executable" value={bukitPath} onChange={(event) => { setBukitPath(event.target.value); setFeedback(""); }} placeholder="/…/bukit" spellCheck={false} /><button type="button" className="secondary" disabled={locked} onClick={() => void browse("Bukit")}>浏览…</button></div>
            <button className="primary" disabled={locked || !bukitPath.trim() || bukitPath.trim() === state?.binary}>保存 Bukit 路径</button>
          </form>
        </section>
        <section className="settings-card" aria-labelledby="codex-settings-heading">
          <div className="settings-card-top"><span className="settings-icon">✳</span><span className={`settings-chip ${chat?.connection === "ready" ? "ready" : ""}`}>{chat?.connection === "ready" ? "已连接" : chat?.connection === "connecting" ? "连接中" : "未连接"}</span></div>
          <h2 id="codex-settings-heading">Codex 对话引擎</h2>
          <p>用于网站讨论和受控生成；不会自动发起模型对话。</p>
          <dl className="settings-facts"><div><dt>检测版本</dt><dd>{chat?.version ?? "尚未检测到可用版本"}</dd></div><div><dt>登录状态</dt><dd>{chat?.account ? `${chat.account.type === "chatgpt" ? "ChatGPT" : "API Key"} 已登录${chat.account.plan ? ` · ${chat.account.plan}` : ""}` : "未登录"}</dd></div></dl>
          {chat?.error && <p className="settings-inline-error" role="alert">{chat.error}</p>}
          <form onSubmit={(event) => { event.preventDefault(); void perform(() => window.desktop.saveCodexPath(codexPath.trim()), "Codex 路径已保存、连接并生效。"); }}>
            <label htmlFor="codex-executable">可执行文件路径</label>
            <div className="settings-path-row"><input id="codex-executable" value={codexPath} onChange={(event) => { setCodexPath(event.target.value); setFeedback(""); }} placeholder="/…/codex" spellCheck={false} /><button type="button" className="secondary" disabled={locked} onClick={() => void browse("Codex")}>浏览…</button></div>
            <div className="settings-actions"><button className="primary" disabled={locked || !codexPath.trim() || codexPath.trim() === chat?.binary}>保存 Codex 路径</button><button type="button" className="secondary" disabled={locked || chat?.connection === "ready"} onClick={() => void perform(() => window.desktop.connectChat(), "Codex 已连接；未发送任何消息。")}>检测连接</button></div>
          </form>
        </section>
      </div>
      <section className="settings-card settings-model" aria-labelledby="model-settings-heading">
        <div><span className="eyebrow">新一轮对话与生成</span><h2 id="model-settings-heading">默认模型</h2><p>不选择时沿用 Codex 当前默认值。更改仅影响之后发起的轮次；已有历史保留，不会重发。</p></div>
        <form onSubmit={(event) => { event.preventDefault(); void perform(() => window.desktop.saveModel({ model: model || null, effort: effort || null }), "模型偏好已保存；下一轮讨论和生成将使用此选择。"); }}>
          <div className="settings-selects"><label htmlFor="settings-model">模型<select id="settings-model" value={model} disabled={locked || chat?.connection !== "ready" || !chat.account} onChange={(event) => { setModel(event.target.value); setEffort(""); setFeedback(""); }}><option value="">Codex 当前默认</option>{chat?.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label htmlFor="settings-effort">推理强度<select id="settings-effort" value={effort} disabled={locked || !selected} onChange={(event) => { setEffort(event.target.value); setFeedback(""); }}><option value="">模型默认</option>{selected?.efforts.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.description}</option>)}</select></label></div>
          {chat?.model && !chat.models.some((item) => item.id === chat.model) && <p className="settings-inline-error">已保存的模型当前不可用，请重新选择或恢复默认。</p>}
          <button className="primary" disabled={locked || (model === (chat?.model ?? "") && effort === (chat?.effort ?? ""))}>保存模型偏好</button>
        </form>
      </section>
      <p className="settings-footnote">切换引擎或模型时，须先完成构建、回复、生成及副本审核。路径和模型偏好保存在应用数据目录。</p>
    </div>
  </main>;
}
