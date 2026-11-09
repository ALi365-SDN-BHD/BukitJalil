#!/usr/bin/env python3
"""M1 spike: list root-relative URLs in a Bukit build output that ignore --base-url.

Usage: python3 -I check-base-url.py <build-dir> <base-url>
Prints every "/..." URL (in attributes, CSS url(), srcset, JSON, XML) that does not start with
<base-url>, grouped by file type, plus a summary. Absolute (https://...) URLs are ignored.
"""
import os
import re
import sys
from collections import Counter, defaultdict

root, base = sys.argv[1], sys.argv[2]
if not base.endswith("/"):
    base += "/"

ATTR = re.compile(r'''(?:href|src|action|poster|data-[\w-]+|content)\s*=\s*["']([^"']*)["']''', re.I)
SRCSET = re.compile(r'''srcset\s*=\s*["']([^"']*)["']''', re.I)
CSSURL = re.compile(r'''url\(\s*["']?([^"')]+)["']?\s*\)''', re.I)
JSONURL = re.compile(r'''"(?:url|href|src|path|route|@id|item|image|logo|contentUrl|target)"\s*:\s*"([^"]*)"''')
XMLURL = re.compile(r'''<(?:loc|link|uri|id)>([^<]*)</''')
TEXT_EXT = {".html", ".htm", ".xml", ".css", ".js", ".json", ".txt", ".webmanifest"}

bad = defaultdict(list)
total = Counter()
for dirpath, _, files in os.walk(root):
    for name in files:
        p = os.path.join(dirpath, name)
        ext = os.path.splitext(name)[1].lower()
        if ext not in TEXT_EXT:
            continue
        text = open(p, encoding="utf-8", errors="replace").read()
        urls = []
        for rx in (ATTR, CSSURL, JSONURL, XMLURL):
            urls += rx.findall(text)
        for s in SRCSET.findall(text):
            urls += [part.strip().split(" ")[0] for part in s.split(",")]
        rel = os.path.relpath(p, root)
        for u in urls:
            u = u.strip()
            if not u.startswith("/") or u.startswith("//"):
                continue
            total[ext] += 1
            if not u.startswith(base):
                bad[ext].append((rel, u))

print(f"root-relative URLs checked: {sum(total.values())}  ({dict(total)})")
nbad = sum(len(v) for v in bad.values())
print(f"not under {base}: {nbad}")
for ext, items in sorted(bad.items()):
    print(f"\n== {ext}: {len(items)}")
    seen = Counter(u for _, u in items)
    for u, n in seen.most_common(25):
        example = next(f for f, x in items if x == u)
        print(f"  {n:4}x  {u}    e.g. {example}")
sys.exit(1 if nbad else 0)
