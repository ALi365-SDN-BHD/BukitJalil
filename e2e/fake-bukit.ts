import fs from "node:fs";
import path from "node:path";

// A stand-in Bukit for end-to-end tests (CI has no Bukit); BUKIT_BIN names a real one instead.

/**
 * Writes index.html titled with site.title and SEO / GEO / publish reports in .bukit/; a committed `fake-mode` file
 * containing "fail" fails the build. `publish audit` passes; `deploy` waits a second and reports a push, without
 * any network.
 */
export const FAKE_BUKIT = `#!/bin/sh
case "$1" in
  version) echo "bukit 2.0.11+e2e"; exit 0;;
  config|doctor) exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    if [ "$(cat fake-mode 2>/dev/null)" = "fail" ]; then
      echo '{"ts":"t","level":"error","msg":"event=content.error file=broken.md"}'
      echo "boom" >&2
      exit 2
    fi
    title=$(grep -m1 '^  title:' site.yaml | sed 's/^  title: *//')
    mkdir -p "$out"
    echo "<!doctype html><meta charset=utf-8><title>$title</title><h1>$title</h1>" > "$out/index.html"
    # The SEO / GEO reports real Bukit writes with every build (a site without site.url).
    mkdir -p "$out/.bukit"
    echo '{"siteUrl":null,"routes":[{},{}],"issues":[{"severity":"warning","code":"seo.canonical_not_absolute","route":"/","message":"Canonical URL should be absolute: /."},{"severity":"warning","code":"seo.description_missing","route":"/","message":"SEO description is missing."},{"severity":"error","code":"seo.title_missing","route":"/about/","message":"Title is missing."}]}' > "$out/.bukit/seo-report.json"
    echo '{"geoScore":25,"llmsTxtGenerated":true,"llmsFullTxtGenerated":false,"geoEnhancedCount":0}' > "$out/.bukit/geo-report.json"
    echo '{"siteUrl":null,"documents":[{}],"issues":[{"severity":"warning","code":"publish.time_missing","route":"/","message":"Dated content is missing a visible time element."}]}' > "$out/.bukit/publish-audit-report.json"
    exit 0;;
  publish) exit 0;;
  deploy) sleep 1; echo "[info] Git push completed. GitHub Pages publication has not been verified."; exit 0;;
esac
exit 1
`;

/** The stand-in, also when BUKIT_BIN is set (a real deploy would push to GitHub). */
export function fakeBukit(dir: string): string {
  const bin = path.join(dir, "fake-bukit");
  fs.writeFileSync(bin, FAKE_BUKIT, { mode: 0o755 });
  return bin;
}

/** The Bukit for a test file: BUKIT_BIN when set, else the stand-in written into `dir`. */
export function bukitForTests(dir: string): string {
  if (process.env.BUKIT_BIN) return process.env.BUKIT_BIN;
  const bin = path.join(dir, "fake-bukit");
  fs.writeFileSync(bin, FAKE_BUKIT, { mode: 0o755 });
  return bin;
}
