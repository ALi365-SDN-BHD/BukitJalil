import { ManagedProcess } from "./process";

// JSONL is used only with our own stdio child; no renderer-supplied methods.
export type RpcObject = Record<string, any>;
export class CodexRpc {
  private readonly process: ManagedProcess;
  private nextId = 0;
  private buffer = "";
  private closed = false;
  private requests: Promise<void> = Promise.resolve();
  private pending = new Map<number, {
    resolve: (value: RpcObject) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
    private readonly event: (method: string, params: RpcObject) => void,
    private readonly lost: (error: Error) => void,
    private readonly timeout = 20_000,
    private readonly toolRequest?: (method: string, params: RpcObject) => Promise<RpcObject>,
  ) {
    this.process = new ManagedProcess(binary, ["app-server", ...args], cwd,
      (chunk) => this.receive(chunk), { stdin: true, stderr: () => {}, env });
    this.process.child.stdin?.on("error", () => this.fail(new Error("Codex 连接已中断。")));
    void this.process.done.then(() => this.fail(new Error("Codex 进程已退出；请重新连接并核对会话。")));
  }

  request(method: string, params: RpcObject = {}): Promise<RpcObject> {
    if (this.closed) return Promise.reject(new Error("Codex 未连接。"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timeout is ambiguous, especially turn/start. Never retry it.
        this.fail(new Error("Codex 请求超时；请重新连接核对，消息不会自动重发。"));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string) { this.write({ method }); }

  private write(value: RpcObject) {
    if (!this.closed) this.process.child.stdin?.write(JSON.stringify(value) + "\n");
  }

  private receive(chunk: string) {
    if (this.closed) return;
    this.buffer += chunk;
    if (this.buffer.length > 8_000_000)
      return this.fail(new Error("Codex 响应超过本应用限制。"));
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error();
        if (typeof value.method === "string") {
          if (value.id !== undefined) {
            this.requests = this.requests.then(async () => {
              if (this.closed) return;
              try {
                if (!this.toolRequest) throw new Error("Tools are disabled");
                const result = await this.toolRequest(value.method, value.params ?? {});
                this.write({ id: value.id, result });
              } catch {
                this.write({ id: value.id, error: { code: -32601, message: "This operation is not allowed by the website tool policy." } });
                this.event("blockedRequest", value.params ?? {});
              }
            });
          } else {
            this.event(value.method, value.params ?? {});
          }
        } else if (typeof value.id === "number") {
          const waiting = this.pending.get(value.id);
          if (!waiting) continue;
          clearTimeout(waiting.timer);
          this.pending.delete(value.id);
          if (value.error) waiting.reject(new Error("Codex 协议请求失败（" + String(value.error.code ?? "unknown") + "）。"));
          else if (value.result && typeof value.result === "object") waiting.resolve(value.result);
          else waiting.reject(new Error("Codex 响应格式不兼容。"));
        } else throw new Error();
      } catch {
        this.fail(new Error("Codex 返回了不兼容的协议数据。"));
        return;
      }
    }
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.lost(error);
    void this.process.stop().catch(() => {});
  }

  async close() {
    this.fail(new Error("Codex 连接已关闭。"));
    await this.process.stop();
    await this.requests;
  }
}
