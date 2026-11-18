import fs from "node:fs";
import os from "node:os";

// On Windows `os.tmpdir()` can be an 8.3 short path (C:\Users\RUNNER~1\...), while `realpath` returns the long
// one, so a test that compares a path with its real path fails on the spelling alone. Use the long form.
if (process.platform === "win32") {
  const real = fs.realpathSync.native(os.tmpdir());
  process.env.TEMP = real;
  process.env.TMP = real;
}
