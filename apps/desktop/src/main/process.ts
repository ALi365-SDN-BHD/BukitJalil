import { spawn, type ChildProcess } from "node:child_process";

export class ManagedProcess {
  readonly child: ChildProcess;
  readonly done: Promise<{ code: number | null; error?: string }>;
  private stopped?: Promise<void>;
  exited = false;

  constructor(
    binary: string,
    args: string[],
    cwd: string,
    output: (text: string) => void,
    options: { stdin?: boolean; stderr?: (text: string) => void; env?: NodeJS.ProcessEnv } = {},
  ) {
    this.child = spawn(binary, args, {
      cwd,
      shell: false,
      detached: true,
      stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...(options.env ?? process.env), NO_COLOR: "1" },
    });
    this.done = new Promise((resolve) => {
      let error: string | undefined;
      this.child.on("error", (e) => {
        error = e.message;
      });
      this.child.on("close", (code) => {
        this.exited = true;
        resolve({ code, error });
      });
    });
    for (const pipe of [this.child.stdout, this.child.stderr]) {
      pipe?.setEncoding("utf8");
      pipe?.on("data", (text: string) =>
        (pipe === this.child.stderr ? options.stderr ?? output : output)(
          text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""),
        ),
      );
    }
  }

  stop(): Promise<void> {
    return (this.stopped ??= this.stopGroup());
  }

  private async stopGroup(): Promise<void> {
    const signal = (kind: NodeJS.Signals) => {
      if (!this.child.pid) return;
      try {
        process.kill(-this.child.pid, kind);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    const force = setTimeout(() => signal("SIGKILL"), 1500);
    try {
      await this.done;
    } finally {
      clearTimeout(force);
      // The leader may exit before descendants that ignored SIGTERM.
      signal("SIGKILL");
    }
  }
}
