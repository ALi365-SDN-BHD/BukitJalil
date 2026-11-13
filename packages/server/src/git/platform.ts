import fs from "node:fs";
import path from "node:path";
import type { GitGuideCommand } from "@bukitjalil/shared";

/** Whether an executable is on PATH; used to pick the platform's package manager. */
export function commandOnPath(command: string, envPath = process.env.PATH ?? ""): boolean {
  const names = process.platform === "win32" ? [`${command}.exe`, `${command}.cmd`, command] : [command];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of names) {
      try {
        fs.accessSync(path.join(dir, name), fs.constants.X_OK);
        return true;
      } catch {
        // not here
      }
    }
  }
  return false;
}

/** The app-managed Git installed by the Windows download, or null. */
export function appGitPath(home: string, platform: string = process.platform): string | null {
  const candidates =
    platform === "win32"
      ? [
          path.join(home, "git", "current", "cmd", "git.exe"),
          path.join(home, "git", "current", "mingw64", "bin", "git.exe"),
          path.join(home, "git", "current", "ucrt64", "bin", "git.exe"),
        ]
      : [path.join(home, "git", "current", "bin", "git")];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not installed
    }
  }
  return null;
}

/** The tool that owns Git on this platform, or null when none is known. */
export function detectPackageManager(platform: string, envPath: string, hasBrew: boolean): string | null {
  if (hasBrew) return "homebrew";
  if (platform === "darwin") return commandOnPath("xcode-select", envPath) ? "xcode" : null;
  if (platform === "linux") {
    for (const [command, name] of [
      ["apt-get", "apt"],
      ["dnf", "dnf"],
      ["pacman", "pacman"],
      ["zypper", "zypper"],
      ["apk", "apk"],
    ] as const) {
      if (commandOnPath(command, envPath)) return name;
    }
    return null;
  }
  if (platform === "win32") {
    if (commandOnPath("winget", envPath)) return "winget";
    if (commandOnPath("choco", envPath)) return "choco";
  }
  return null;
}

/** Install/update commands for the current platform; empty when no known package manager exists. */
export function gitGuide(platform: string, manager: string | null): GitGuideCommand[] {
  const homebrew = { title: "Homebrew", command: "brew install git\nbrew upgrade git" };
  const xcode = { title: "Xcode Command Line Tools", command: "xcode-select --install" };
  if (platform === "darwin") return manager === "homebrew" ? [homebrew, xcode] : [xcode];
  if (platform === "linux") {
    if (manager === "homebrew") return [homebrew];
    if (manager === "apt")
      return [
        { title: "Debian / Ubuntu (apt)", command: "sudo apt install git\nsudo apt update && sudo apt upgrade git" },
      ];
    if (manager === "dnf") return [{ title: "Fedora (dnf)", command: "sudo dnf install git\nsudo dnf upgrade git" }];
    if (manager === "pacman") return [{ title: "Arch (pacman)", command: "sudo pacman -S git\nsudo pacman -Syu git" }];
    if (manager === "zypper")
      return [{ title: "openSUSE (zypper)", command: "sudo zypper install git\nsudo zypper update git" }];
    if (manager === "apk") return [{ title: "Alpine (apk)", command: "sudo apk add git\nsudo apk upgrade git" }];
    return [];
  }
  if (platform === "win32") {
    if (manager === "winget")
      return [
        {
          title: "Windows (winget)",
          command: "winget install --id Git.Git -e\nwinget upgrade --id Git.Git -e",
        },
      ];
    if (manager === "choco")
      return [{ title: "Windows (Chocolatey)", command: "choco install git\nchoco upgrade git" }];
  }
  return [];
}
