import { type UtilityProcess, utilityProcess } from "electron";

/** Messages from the server's desktop mode (packages/server/src/desktop.ts). */
type Outbound =
  | { type: "ready"; port: number }
  | { type: "login"; url: string }
  | { type: "error"; code: string; message: string };

export type StartResult = { ok: true; port: number } | { ok: false; code: string; message: string };

export interface ServerOptions {
  /** main.ts (with tsx) during development, the bundled server.mjs in the app. */
  entry: string;
  execArgv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** First admin port to try; the next attempts move up by PORT_STEP. */
  firstPort: number;
}

const ATTEMPTS = 10;
/** Room for a few preview ports above each admin port tried. */
const PORT_STEP = 10;
const TAIL_LINES = 40;
const LOGIN_TIMEOUT_MS = 10_000;

/**
 * The server in an Electron utility process (plan M7): started on the first free port, asked for login
 * links, stopped with the server's own shutdown and ended if that takes too long.
 */
export class ServerProcess {
  private child: UtilityProcess | null = null;
  private stopping = false;
  private tail: string[] = [];
  private logins: ((url: string) => void)[] = [];
  private starting: Promise<StartResult> | null = null;
  port = 0;
  /** The server ended by itself after it was ready. */
  onExit: (code: number, tail: string) => void = () => {};

  constructor(private readonly opts: ServerOptions) {}

  get running(): boolean {
    return this.child !== null;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The last lines the server printed, for the error page. */
  output(): string {
    return this.tail.join("\n");
  }

  /** Start the server, or join the start already under way (a second window can ask while it runs). */
  start(): Promise<StartResult> {
    if (!this.starting) this.starting = this.startFresh().finally(() => (this.starting = null));
    return this.starting;
  }

  private async startFresh(): Promise<StartResult> {
    this.stopping = false;
    this.tail = [];
    let last: StartResult = { ok: false, code: "port_in_use", message: "" };
    for (let i = 0; i < ATTEMPTS; i++) {
      last = await this.startOn(this.opts.firstPort + i * PORT_STEP);
      if (last.ok || last.code !== "port_in_use") return last;
    }
    return last;
  }

  private startOn(port: number): Promise<StartResult> {
    const child = utilityProcess.fork(
      this.opts.entry,
      ["--desktop", "--port", String(port), "--preview-port-base", String(port + 1)],
      {
        cwd: this.opts.cwd,
        env: this.opts.env,
        execArgv: this.opts.execArgv,
        stdio: "pipe",
        serviceName: "BukitJalil Server",
      },
    );
    const keep = (chunk: Buffer) => {
      this.tail.push(...chunk.toString("utf8").split("\n").filter(Boolean));
      this.tail.splice(0, Math.max(0, this.tail.length - TAIL_LINES));
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    return new Promise((resolve) => {
      let settled = false;
      child.on("message", (message: Outbound) => {
        if (message.type === "login") {
          this.logins.shift()?.(message.url);
          return;
        }
        if (settled) return;
        settled = true;
        if (message.type === "ready") {
          this.child = child;
          this.port = message.port;
          resolve({ ok: true, port: message.port });
        } else {
          resolve({ ok: false, code: message.code, message: message.message });
        }
      });
      child.on("exit", (code) => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, code: "exited", message: this.output() });
          return;
        }
        if (this.child !== child) return;
        this.child = null;
        for (const pending of this.logins.splice(0)) pending("");
        if (!this.stopping) this.onExit(code, this.output());
      });
    });
  }

  /** A fresh one-time login link, or "" when the server did not answer. */
  login(): Promise<string> {
    const child = this.child;
    if (!child) return Promise.resolve("");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logins = this.logins.filter((r) => r !== done);
        resolve("");
      }, LOGIN_TIMEOUT_MS);
      const done = (url: string) => {
        clearTimeout(timer);
        resolve(url);
      };
      this.logins.push(done);
      child.postMessage({ type: "login" });
    });
  }

  /**
   * Ask the server to shut down; end it after `timeoutMs`. The server stops its Bukit processes (up to 10 s
   * each, in parallel) and waits up to 15 s for site operations, so the budget is above both.
   */
  stop(timeoutMs = 30_000): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.postMessage({ type: "shutdown" });
    });
  }
}
