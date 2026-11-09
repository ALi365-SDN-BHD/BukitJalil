// M1 spike: preview isolation and CSRF defenses, tested in a real browser.
// Admin port 47880 mimics the management API rules (plan §11); preview port 47881 serves an
// "AI-written" page that tries every trick to make the admin API do something or leak data.
// Run: node preview-isolation.mjs, open http://127.0.0.1:47880/ and read /api/state afterwards,
// or drive it in three browsers with preview-isolation-browsers.mjs (which imports this file).
import http from "node:http";

const ADMIN = 47880, PREVIEW = 47881;
const ADMIN_ORIGIN = `http://127.0.0.1:${ADMIN}`;
const COOKIE = "bj=spike-token";
export const state = { applied: 0, rejected: [], leakReads: 0, requests: [], guardedHits: 0, previewHits: [], evilLog: [] };
export function resetState() { Object.assign(state, { applied: 0, rejected: [], leakReads: 0, requests: [], guardedHits: 0, previewHits: [], evilLog: [] }); }

const adminCsp = "default-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src http://127.0.0.1:47881";
// /guarded is the same page with the anti-framing headers the plan should add.
const guardHeaders = { "Content-Security-Policy": `${adminCsp}; frame-ancestors 'none'`, "X-Frame-Options": "DENY" };
const previewCsp = "sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'";

export const adminServer = http.createServer((req, res) => {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${ADMIN}` && host !== `localhost:${ADMIN}`) { res.writeHead(421).end("bad host"); return; }
  const url = new URL(req.url, ADMIN_ORIGIN);
  if (url.pathname.startsWith("/api/")) {
    state.requests.push({ method: req.method, path: url.pathname + url.search, origin: req.headers.origin ?? null,
      cookie: (req.headers.cookie ?? "").includes(COOKIE), dest: req.headers["sec-fetch-dest"] ?? null, site: req.headers["sec-fetch-site"] ?? null });
  }
  if (url.pathname === "/guarded") {
    state.guardedHits++;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...guardHeaders });
    res.end("<!doctype html><meta charset=utf-8><title>admin-guarded</title><button>危险操作</button>");
    return;
  }
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": adminCsp,
      "Set-Cookie": `${COOKIE}; HttpOnly; SameSite=Strict; Path=/api` });
    res.end(`<!doctype html><meta charset=utf-8><title>admin</title><h1>admin</h1>
<p>Cookie set. The preview below is AI-written and must not be able to call /api.</p>
${url.searchParams.has("noframe") ? "" : `<iframe id=pv sandbox="allow-scripts" src="http://127.0.0.1:${PREVIEW}/evil.html" width=900 height=420></iframe>`}
<p><a href="/api/state">/api/state</a></p>`);
    return;
  }
  if (url.pathname === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(state, null, 1));
    return;
  }
  if (url.pathname === "/api/secret") { // GET with data: must not be readable cross-origin
    if ((req.headers.cookie ?? "").includes(COOKIE)) state.leakReads++;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ apiKey: "sk-SECRET" }));
    return;
  }
  if (url.pathname === "/api/apply") {
    const reasons = [];
    if (req.method === "OPTIONS") { state.rejected.push({ why: "preflight refused", origin: req.headers.origin }); res.writeHead(403).end(); return; }
    if (req.method !== "POST") reasons.push("method");
    if (req.headers.origin !== ADMIN_ORIGIN) reasons.push(`origin=${req.headers.origin}`);
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) reasons.push(`ctype=${req.headers["content-type"]}`);
    if (req.headers["x-bukitjalil"] !== "1") reasons.push("no X-BukitJalil");
    if (!(req.headers.cookie ?? "").includes(COOKIE)) reasons.push("no cookie");
    if (reasons.length) { state.rejected.push({ why: reasons.join(", ") }); res.writeHead(403).end(); return; }
    state.applied++;
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    return;
  }
  res.writeHead(404).end();
}).listen(ADMIN, "127.0.0.1");

const evil = `<!doctype html><meta charset=utf-8><title>evil preview</title>
<h2>AI-written preview page</h2><pre id=log></pre>
<form id=f method=POST action="${ADMIN_ORIGIN}/api/apply" enctype="text/plain"><input name='{"a":1,"x":"' value='"}'></form>
<img src="${ADMIN_ORIGIN}/api/apply" alt="">
<img src="${ADMIN_ORIGIN}/api/secret?via=img" alt="">
<iframe id=adminframe src="${ADMIN_ORIGIN}/?noframe=1" width=300 height=100></iframe>
<iframe id=guardedframe src="${ADMIN_ORIGIN}/guarded" width=300 height=100></iframe>
<script>
const log = (m) => { document.getElementById('log').textContent += m + "\\n"; console.log("[evil] " + m); new Image().src = "/log?m=" + encodeURIComponent((self === top ? "top: " : "frame: ") + m); };
log("origin seen by script: " + self.origin);
(async () => {
  for (const [name, init, path] of [
    ["fetch POST json+header", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-BukitJalil": "1" }, body: "{}" }, "/api/apply"],
    ["fetch POST text/plain no-cors", { method: "POST", mode: "no-cors", credentials: "include", headers: { "Content-Type": "text/plain" }, body: "{}" }, "/api/apply"],
    ["fetch GET secret", { credentials: "include" }, "/api/secret"],
  ]) {
    try { const r = await fetch("${ADMIN_ORIGIN}" + path, init); log(name + ": status " + r.status + " body " + (await r.text()).slice(0, 40)); }
    catch (e) { log(name + ": blocked (" + e.message + ")"); }
  }
  try { navigator.sendBeacon("${ADMIN_ORIGIN}/api/apply", "{}"); log("sendBeacon: called"); } catch (e) { log("sendBeacon: blocked " + e.message); }
  try { document.getElementById('f').submit(); log("form.submit: called"); } catch (e) { log("form.submit: blocked " + e.message); }
  try { document.cookie = "x=1"; log("document.cookie write: ok"); } catch (e) { log("document.cookie: blocked (" + e.name + ")"); }
  try { localStorage.setItem("x", "1"); log("localStorage: ok"); } catch (e) { log("localStorage: blocked (" + e.name + ")"); }
  log("done");
})();
</script>`;

export const previewServer = http.createServer((req, res) => {
  const host = req.headers.host;
  state.previewHits.push({ host, path: req.url });
  if (host !== `127.0.0.1:${PREVIEW}` && host !== `localhost:${PREVIEW}`) { res.writeHead(421).end("bad host"); return; }
  if (req.url.startsWith("/log?")) { state.evilLog.push(new URL(req.url, "http://x").searchParams.get("m")); res.writeHead(204).end(); return; }
  if (req.url === "/evil.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": previewCsp, "X-Content-Type-Options": "nosniff" });
    res.end(evil);
    return;
  }
  res.writeHead(404).end();
}).listen(PREVIEW, "127.0.0.1");

console.log(`admin   ${ADMIN_ORIGIN}/\npreview http://127.0.0.1:${PREVIEW}/evil.html`);
