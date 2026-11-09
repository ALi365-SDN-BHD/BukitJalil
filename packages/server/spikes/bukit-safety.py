#!/usr/bin/env python3
"""M1 spike: Bukit's safety surface for builds of untrusted (AI-written) sites.

Usage: BUKIT=/path/to/bukit BUKIT_SRC=/path/to/Bukit/clone python3 -I bukit-safety.py
Each case starts from a fresh starter site (make-starter.sh), changes one thing, runs
`bukit build`, and reports whether outside data reached the output or an external program ran.
"""
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading

BUKIT = os.environ["BUKIT"]
BUKIT_SRC = os.environ["BUKIT_SRC"]
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = tempfile.mkdtemp(prefix="bj-safety-", dir=os.environ.get("TMPDIR"))
SECRET = "OUTSIDE-SECRET-7f3a"
OUTSIDE = os.path.join(WORK, "outside")
MARK = os.path.join(WORK, "markers")
os.makedirs(OUTSIDE)
os.makedirs(MARK)

# Outside data an AI-written site should never be able to pull into a build.
os.makedirs(os.path.join(OUTSIDE, "content"))
with open(os.path.join(OUTSIDE, "content", "leak.md"), "w") as f:
    f.write(f"---\ncollection: post\ntitle: Leak\nslug: leak\n---\n\n{SECRET}\n")
with open(os.path.join(OUTSIDE, "secret.txt"), "w") as f:
    f.write(SECRET)
with open(os.path.join(OUTSIDE, "secret.css"), "w") as f:
    f.write(f"/* {SECRET} */ body {{ color: red; }}\n")
os.makedirs(os.path.join(OUTSIDE, "layouts", "pages"))

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""), flush=True)


def new_site(name, langs=()):
    d = os.path.join(WORK, name)
    subprocess.run([os.path.join(HERE, "make-starter.sh"), d, *langs], check=True,
                   env={**os.environ, "BUKIT_SRC": BUKIT_SRC}, stdout=subprocess.DEVNULL)
    return d


def bukit(site, *args, path=None):
    env = {"PATH": path or "/usr/bin:/bin", "HOME": WORK, "LANG": "C", "TMPDIR": os.path.join(WORK, "tmp") + "/"}
    os.makedirs(env["TMPDIR"], exist_ok=True)
    p = subprocess.run([BUKIT, *args], cwd=site, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, p.stdout + p.stderr


def build(site, path=None):
    out = os.path.join(site, ".bukitjalil-build", "b")
    if os.path.exists(out):
        shutil.rmtree(out)
    rc, log = bukit(site, "build", "--config", "site.yaml", "--output", ".bukitjalil-build/b", "--no-clean", path=path)
    return rc, log, out


def output_contains(out, needle):
    for dp, _, files in os.walk(out):
        for fn in files:
            try:
                if needle in open(os.path.join(dp, fn), encoding="utf-8", errors="ignore").read():
                    return os.path.relpath(os.path.join(dp, fn), out)
            except OSError:
                pass
    return None


def edit_yaml(site, old, new):
    p = os.path.join(site, "site.yaml")
    s = open(p).read()
    assert old in s, old
    open(p, "w").write(s.replace(old, new))


def first_line(log, *keys):
    for line in log.splitlines():
        if any(k in line.lower() for k in keys):
            return line.strip()[:140]
    return ""


print(f"work: {WORK}\nbukit: {bukit(WORK, 'version')[1].splitlines()[0]}\n")

# --- 1. external CLI plugins --------------------------------------------------------------
print("-- plugins")
s = new_site("plugins")
os.makedirs(os.path.join(s, ".bukit"))
os.makedirs(os.path.join(s, "plugins", "evil"))
evil = os.path.join(s, "plugins", "evil", "run.sh")
open(evil, "w").write(f"#!/bin/sh\necho ran >> {MARK}/plugin\n")
os.chmod(evil, 0o755)
open(os.path.join(s, ".bukit", "plugins.yaml"), "w").write(
    "version: 1\nplugins:\n  evil:\n    source: plugins/evil\n    enabled: true\n    exposeCommands: [evil]\n")
open(os.path.join(s, "plugins", "evil", "plugin.yaml"), "w").write(
    "id: evil\nversion: 1.0.0\nentry:\n  default: run.sh\ncommands:\n  - name: evil\n")
for args in (["build", "--config", "site.yaml", "--output", ".bukitjalil-build/b", "--no-clean"],
             ["config", "check", "--config", "site.yaml"], ["doctor", "--config", "site.yaml"]):
    rc, log = bukit(s, *args)
    record(f"core `{args[0]}` ignores .bukit/plugins.yaml (rc={rc})",
           not os.path.exists(os.path.join(MARK, "plugin")) and "plugins.yaml" not in log, first_line(log, "plugin"))
rc, log = bukit(s, "evil")
record("control: non-core command reads .bukit/plugins.yaml", "plugin" in log.lower(), first_line(log, "plugin"))

# --- 2. path fields -----------------------------------------------------------------------
print("-- path fields (absolute and ../ values)")
cases = [
    ("content.sources[].markdown.dir", "        dir: content\n", "        dir: {v}\n", f"{OUTSIDE}/content", "../outside/content"),
    ("theme.layouts", "  layouts: layouts\n", "  layouts: {v}\n", f"{OUTSIDE}/layouts", "../../../outside/layouts"),
    ("theme.static", "  static: static\n", "  static: {v}\n", OUTSIDE, "../../../outside"),
    ("theme.assets", "  assets: assets\n", "  assets: {v}\n", OUTSIDE, "../../../outside"),
    ("theme.name", "  name: starter\n", "  name: {v}\n", OUTSIDE, "../../outside"),
]
for field, old, tmpl, absval, relval in cases:
    for kind, val in (("absolute", absval), ("../", relval)):
        s = new_site(f"path-{field.replace('.', '_').replace('[]', '')}-{'abs' if kind == 'absolute' else 'rel'}")
        if field == "theme.layouts":  # give the outside layouts a page that prints the secret
            for t in os.listdir(os.path.join(s, "themes/starter/layouts/pages")):
                open(os.path.join(OUTSIDE, "layouts/pages", t), "w").write(SECRET)
        edit_yaml(s, old, tmpl.format(v=val))
        rc, log, out = build(s)
        leaked = output_contains(out, SECRET) if os.path.isdir(out) else None
        record(f"{field} = {kind} path outside the site: no outside data in output (rc={rc})",
               leaked is None, f"leaked into {leaked}" if leaked else first_line(log, "error", "outside", "travers", "escape"))

for field, old, new in [
    ("build.output via --output", None, None),
    ("content.media.downloadDir", "build:\n", "  media:\n    downloadDir: {v}\nbuild:\n"),
]:
    if old is None:
        s = new_site("path-output-abs")
        rc, log = bukit(s, "build", "--config", "site.yaml", "--output", os.path.join(OUTSIDE, "dist"), "--no-clean")
        record(f"{field} absolute outside the site is refused (rc={rc})",
               not os.path.exists(os.path.join(OUTSIDE, "dist", "index.html")), first_line(log, "error", "outside"))
        continue
    s = new_site("path-media-abs")
    edit_yaml(s, "content:\n  sources:\n", "content:\n  sources:\n")  # sanity
    p = os.path.join(s, "site.yaml")
    y = open(p).read().replace("build:\n", f"  media:\n    downloadDir: {OUTSIDE}/media\nbuild:\n", 1)
    y = y.replace("content:\n  sources:", f"content:\n  media:\n    downloadDir: {OUTSIDE}/media\n  sources:", 1).replace(f"  media:\n    downloadDir: {OUTSIDE}/media\nbuild:", "build:")
    open(p, "w").write(y)
    rc, log, out = build(s)
    record(f"{field} absolute outside the site is refused (rc={rc})", rc != 0, first_line(log, "error", "download"))

# --- 3. symlinks --------------------------------------------------------------------------
print("-- symlinks")
s = new_site("symlink-control")
open(os.path.join(s, "content", "posts", "plain.md"), "w").write(f"---\ncollection: post\ntitle: Plain\nslug: plain\n---\n\nINSIDE-MARKER-1\n")
rc, log, out = build(s)
record(f"control: a normal content file reaches the output (rc={rc})", output_contains(out, "INSIDE-MARKER-1") is not None)
s = new_site("symlink-content")
os.symlink(os.path.join(OUTSIDE, "content", "leak.md"), os.path.join(s, "content", "posts", "leak.md"))
rc, log, out = build(s)
leaked = output_contains(out, SECRET) if os.path.isdir(out) else None
record(f"content .md symlinked to outside file is not read (rc={rc})", leaked is None, f"leaked into {leaked}" if leaked else first_line(log, "symlink", "error"))
s = new_site("symlink-static")
os.symlink(os.path.join(OUTSIDE, "secret.txt"), os.path.join(s, "themes/starter/static/secret.txt"))
rc, log, out = build(s)
leaked = output_contains(out, SECRET) if os.path.isdir(out) else None
record(f"static file symlinked to outside file is not copied (rc={rc})", leaked is None, f"leaked into {leaked}" if leaked else first_line(log, "symlink", "error"))
s = new_site("symlink-dir")
os.symlink(os.path.join(OUTSIDE, "content"), os.path.join(s, "content", "linked"))
rc, log, out = build(s)
leaked = output_contains(out, SECRET) if os.path.isdir(out) else None
record(f"content dir symlinked to outside dir is not read (rc={rc})", leaked is None, f"leaked into {leaked}" if leaked else first_line(log, "symlink", "error"))

# --- 4. external tools on PATH (sass) -------------------------------------------------------
print("-- external tools")
fakebin = os.path.join(WORK, "fakebin")
os.makedirs(fakebin)
for tool in ("sass", "dart-sass", "magick", "convert", "cwebp"):
    t = os.path.join(fakebin, tool)
    open(t, "w").write(f"#!/bin/sh\necho {tool} \"$@\" >> {MARK}/tools\n[ \"$1\" = --version ] && echo 1.0.0\nexit 0\n")
    os.chmod(t, 0o755)
s = new_site("scss")
open(os.path.join(s, "themes/starter/assets/main.scss"), "w").write(f'@import "{OUTSIDE}/secret.css";\n')
edit_yaml(s, "  static: static\n", "  static: static\n  scss:\n    enabled: true\n    entryPoint: main.scss\n")
for label, path in (("minimal PATH (/usr/bin:/bin)", None), ("PATH with sass/magick", f"{fakebin}:/usr/bin:/bin")):
    if os.path.exists(os.path.join(MARK, "tools")):
        os.remove(os.path.join(MARK, "tools"))
    rc, log, out = build(s, path=path)
    ran = open(os.path.join(MARK, "tools")).read().split("\n")[0] if os.path.exists(os.path.join(MARK, "tools")) else ""
    if path is None:
        record(f"theme.scss with {label}: no external program runs (rc={rc})", not ran, first_line(log, "scss"))
    else:
        record(f"control: theme.scss with {label} runs it (rc={rc})", bool(ran), ran[:100])

# --- 5. remote media and private networks ---------------------------------------------------
print("-- media downloads")
hits = []


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        hits.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.end_headers()
        self.wfile.write(b"\x89PNG\r\n\x1a\n" + b"\0" * 64)

    def log_message(self, *a):
        pass


try:
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    for label, block in (("default (blockPrivateNetworks unset)", None), ("blockPrivateNetworks: false", False)):
        hits.clear()
        s = new_site("media-" + ("default" if block is None else "off"))
        md = os.path.join(s, "content/posts/img.md")
        open(md, "w").write(f"---\ncollection: post\ntitle: Img\nslug: img\n---\n\n![x](http://127.0.0.1:{port}/private.png)\n")
        media = "  media:\n    downloadToLocal: true\n" + ("" if block is None else f"    blockPrivateNetworks: {str(block).lower()}\n")
        edit_yaml(s, "content:\n  sources:\n", f"content:\n{media}  sources:\n")
        rc, log, out = build(s)
        if block is None:
            record(f"media {label}: no request to 127.0.0.1 (rc={rc})", not hits, f"requests: {hits}" if hits else first_line(log, "media", "private", "block"))
        else:
            record(f"control: media {label} does fetch 127.0.0.1 (rc={rc})", bool(hits), f"requests: {hits}" if hits else first_line(log, "media", "error"))
    srv.shutdown()
except PermissionError as e:
    record("media private-network test (local listener)", False, f"could not bind a local port: {e}")

fails = [r for r in results if not r[1]]
print(f"\npassed: {len(results) - len(fails)}  failed: {len(fails)}\n(work dir kept: {WORK})")
json.dump([{"case": n, "pass": ok, "detail": d} for n, ok, d in results], open(os.path.join(WORK, "results.json"), "w"), indent=1)
sys.exit(1 if fails else 0)
