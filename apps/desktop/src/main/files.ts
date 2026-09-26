import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function scopedPath(
  root: string,
  relative: string,
): Promise<string> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((p) => p === ".." || p === "" || p === ".")
  ) {
    throw new Error("拒绝项目路径之外的文件操作。");
  }
  if ((await fs.realpath(root)) !== root)
    throw new Error("项目目录已移动或被替换，请重新打开。");
  let current = root;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await fs.lstat(current);
      if (
        stat.isSymbolicLink() ||
        (!stat.isFile() && !stat.isDirectory()) ||
        (stat.isFile() && stat.nlink !== 1)
      ) {
        throw new Error("项目中不允许符号链接、硬链接或特殊文件。");
      }
      if (i < parts.length - 1 && !stat.isDirectory())
        throw new Error("项目目录结构无效。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}

export async function readText(
  root: string,
  relative: string,
  limit = 8 * 1024 * 1024,
): Promise<string> {
  const filename = await scopedPath(root, relative);
  if ((await fs.stat(filename)).size > limit)
    throw new Error("项目文件超过大小限制。");
  return fs.readFile(filename, "utf8");
}

export async function atomicWrite(
  root: string,
  relative: string,
  content: string,
  beforeRename?: () => Promise<void>,
): Promise<void> {
  const filename = await scopedPath(root, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await scopedPath(root, relative);
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await scopedPath(root, relative);
    await beforeRename?.();
    await fs.rename(temp, filename);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export async function checkOutputTree(
  root: string,
  relative: string,
): Promise<void> {
  const dir = await scopedPath(root, relative);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    await scopedPath(root, child);
    if (entry.isDirectory()) await checkOutputTree(root, child);
  }
}
