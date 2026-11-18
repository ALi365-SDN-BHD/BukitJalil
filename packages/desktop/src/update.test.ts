import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { replaceAppImage } from "./update.ts";

const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe.skipIf(process.platform === "win32")("replaceAppImage", () => {
  it("replaces the running file, makes it executable, and asks for a relaunch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-appimage-"));
    const running = path.join(root, "BukitJalil.AppImage");
    const downloaded = path.join(root, "downloaded.AppImage");
    fs.writeFileSync(running, "old");
    fs.writeFileSync(downloaded, "new");
    const relaunch = vi.fn();
    expect(await replaceAppImage(downloaded, running, relaunch)).toBeNull();
    expect(fs.readFileSync(running, "utf8")).toBe("new");
    expect(mode(running)).toBe(0o755);
    expect(relaunch).toHaveBeenCalledWith(fs.realpathSync(running));
  });

  it("does not touch a file that is not an AppImage", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-appimage-"));
    const running = path.join(root, "BukitJalil.bin");
    const downloaded = path.join(root, "downloaded.AppImage");
    fs.writeFileSync(running, "old");
    fs.writeFileSync(downloaded, "new");
    expect(await replaceAppImage(downloaded, running, () => {})).toBe("not an AppImage");
    expect(fs.readFileSync(running, "utf8")).toBe("old");
  });
});
