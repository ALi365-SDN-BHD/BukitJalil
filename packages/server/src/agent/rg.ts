import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { InstallProgress, RgStatus } from "@bukitjalil/shared";
import { download, InstallError, InstallJob, installFile, readStrictTarGz, verifySha256 } from "../bukit/install.ts";
import { runProbe } from "../probe.ts";

/**
 * ripgrep for Pi's grep tool (plan 6.3). Pi would download rg on its own; BukitJalil runs it offline and
 * installs a pinned release instead: the archive and the rg binary inside it are both checked against
 * SHA-256 values in this file, and grep runs only while the installed binary still matches.
 */

export const RG_VERSION = "15.2.0";

export interface RgPackage {
  /** Release target, e.g. aarch64-apple-darwin; also the archive's top directory suffix. */
  target: string;
  /** SHA-256 of the .tar.gz. */
  sha256: string;
  /** SHA-256 of the rg binary inside it, checked again whenever grep asks for it. */
  rgSha256: string;
  /** Size of that binary in bytes, compared before hashing, so a wrong file is never read in full. */
  rgSize: number;
}

/** Pinned packages by `${process.platform}-${process.arch}`. Windows has no grep in the MVP (plan 1.2). */
export const RG_PACKAGES: Record<string, RgPackage> = {
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
    rgSha256: "a326a1fb48074202e9ad41e4cd1e389eeea372c8c6f7d7e80da81176d5d9430e",
    rgSize: 4_014_576,
  },
  "darwin-x64": {
    target: "x86_64-apple-darwin",
    sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
    rgSha256: "0c9a0066db0d26b640777db88045b0ccdd58509a746700e43e1c4ff8707a5ed0",
    rgSize: 4_387_000,
  },
  "linux-x64": {
    target: "x86_64-unknown-linux-musl",
    sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
    rgSha256: "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849",
    rgSize: 5_408_904,
  },
  "linux-arm64": {
    target: "aarch64-unknown-linux-musl",
    sha256: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915",
    rgSha256: "c14cdb389f34e504d69e386cfc67d5c5d9a730a990de03ca6910b2a15e30386a",
    rgSize: 4_466_000,
  },
};

/** Everything in a release archive, under its top directory; anything else fails the install. */
const ARCHIVE_FILES = [
  "rg",
  "COPYING",
  "LICENSE-MIT",
  "README.md",
  "UNLICENSE",
  "complete/_rg",
  "complete/_rg.ps1",
  "complete/rg.bash",
  "complete/rg.fish",
  "doc/CHANGELOG.md",
  "doc/FAQ.md",
  "doc/GUIDE.md",
  "doc/rg.1",
];
const ARCHIVE_DIRS = ["", "complete", "doc"];

export const rgArchiveRoot = (pkg: RgPackage) => `ripgrep-${RG_VERSION}-${pkg.target}`;
export const rgArchiveLayout = (pkg: RgPackage) => {
  const root = rgArchiveRoot(pkg);
  return {
    files: ARCHIVE_FILES.map((f) => `${root}/${f}`),
    dirs: ARCHIVE_DIRS.map((d) => (d ? `${root}/${d}` : root)),
  };
};
const rgUrl = (pkg: RgPackage) =>
  `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${rgArchiveRoot(pkg)}.tar.gz`;

export interface RgServiceOptions {
  /** Pi's bin directory (~/.bukitjalil/pi/bin); rg is installed there as `rg`. */
  piBin: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  /** Replaces RG_PACKAGES (tests). */
  packages?: Record<string, RgPackage>;
}

const sha256File = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Status and install of BukitJalil's rg. The status hashes the installed file, and the result is kept
 * until the file's inode, size or times change, so grep can ask before every search.
 */
export class RgService {
  readonly installer: InstallJob;
  readonly rgPath: string;
  private readonly pkg: RgPackage | null;
  private cache: { key: string; state: RgStatus["state"] } | null = null;

  constructor(private readonly opts: RgServiceOptions) {
    const packages = opts.packages ?? RG_PACKAGES;
    this.pkg = packages[`${opts.platform ?? process.platform}-${opts.arch ?? process.arch}`] ?? null;
    this.rgPath = path.join(opts.piBin, "rg");
    this.installer = new InstallJob((report) => this.install(report));
  }

  status(): RgStatus {
    return { state: this.state(), version: RG_VERSION, installable: this.pkg !== null };
  }

  /** The pinned rg is installed and unchanged; grep is refused otherwise. */
  ready(): boolean {
    return this.state() === "ok";
  }

  private state(): RgStatus["state"] {
    if (!this.pkg) return "missing";
    let st: fs.Stats;
    try {
      st = fs.lstatSync(this.rgPath);
    } catch {
      return "missing";
    }
    if (!st.isFile() || st.size !== this.pkg.rgSize) return "mismatch";
    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.mode}`;
    if (this.cache?.key === key) return this.cache.state;
    let state: RgStatus["state"];
    try {
      state = (st.mode & 0o111) !== 0 && sha256File(this.rgPath) === this.pkg.rgSha256 ? "ok" : "mismatch";
    } catch {
      state = "mismatch";
    }
    this.cache = { key, state };
    return state;
  }

  private async install(report: (progress: InstallProgress) => void): Promise<void> {
    const pkg = this.pkg;
    if (!pkg) throw new InstallError("unsupported_platform", "no pinned rg package for this platform");
    const data = await download(
      rgUrl(pkg),
      (received, total) => report({ state: "downloading", received, total }),
      this.opts.fetchImpl,
    );
    report({ state: "verifying" });
    verifySha256(data, pkg.sha256);
    const { files, dirs } = rgArchiveLayout(pkg);
    const rg = readStrictTarGz(data, files, dirs).get(`${rgArchiveRoot(pkg)}/rg`);
    if (!rg) throw new InstallError("bad_archive", "rg is missing from the archive");
    verifySha256(rg.data, pkg.rgSha256);
    installFile(rg.data, this.rgPath, 0o755);
    const probe = await runProbe(this.rgPath, ["--version"], { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" });
    if (!probe.ok) {
      // The binary matches its SHA-256, so it stays; a busy machine can time out a probe. Grep may still
      // fail on a system that cannot run it (e.g. a noexec home), which the message says.
      throw new InstallError(
        "verify_failed",
        `rg is installed and matches its SHA-256, but rg --version did not run (${probe.reason}); grep may not work`,
      );
    }
    const version = probe.stdout.split("\n")[0]?.trim() ?? "";
    if (version !== `ripgrep ${RG_VERSION}` && !version.startsWith(`ripgrep ${RG_VERSION} `)) {
      fs.rmSync(this.rgPath, { force: true });
      throw new InstallError("verify_failed", `rg --version printed ${version || "nothing"}`);
    }
  }
}
