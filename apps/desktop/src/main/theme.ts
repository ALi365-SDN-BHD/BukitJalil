import type { ThemeCopy } from "../shared";

// Bundled library version. Projects receive a deep copy; edits never write here.
export function sampleTheme(): ThemeCopy {
  return {
    name: "Canopy",
    version: "1.0.0",
    files: {
      "themes/canopy/theme.yaml": `name: canopy
display_name: Canopy
version: 1.0.0
engine: bukit
description: A quiet home for a small independent studio
templates:
  home:
    template: pages/index.html
    required: true
  page:
    template: pages/page.html
    accepts:
      collection: page
assets:
  css:
    - assets/style.css
`,
      "themes/canopy/layouts/layouts/base.html": `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ site.title | html.escape }}</title><link rel="stylesheet" href="/assets/style.css"></head>
<body><header><a class="brand" href="/">canopy<span>独立工作室</span></a><nav aria-label="网站导航"><a href="/">首页</a><a href="/about/">关于我们 ↗</a></nav></header><main>{{ content }}</main><footer><span>让好想法，在这里生长。</span><span>CANOPY / KUALA LUMPUR</span></footer></body></html>`,
      "themes/canopy/layouts/pages/index.html": `{% layout "layouts/base.html" %}
<section class="hero"><p class="eyebrow">小小的网站，大大的开始</p><h1>{{ site.title | html.escape }}</h1><p class="intro">为认真生活、用心创造的人，留一片自己的空间。</p><a class="cta" href="/about/">认识我们 <span>↗</span></a><div class="landscape" aria-hidden="true"><div class="sun"></div><div class="hill back"></div><div class="hill front"></div><span>SPACE TO GROW</span></div></section>
<section class="notes"><p>从一个想法开始</p><div><h2>把日常，做成喜欢的样子。</h2><p>这里可以是你的作品集、小生意，或下一次出发的起点。慢慢打磨，让每一处都像你。</p></div></section>`,
      "themes/canopy/layouts/pages/page.html": `{% layout "layouts/base.html" %}
<article><p class="eyebrow">关于 CANOPY</p><h1>{{ page.title | html.escape }}</h1>{{ page.content }}</article>`,
      "themes/canopy/assets/style.css": `:root{color:#203d36;background:#f7faf8;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}a:focus-visible{outline:3px solid #cc6e36;outline-offset:6px}header,footer{display:flex;justify-content:space-between;align-items:center;padding:28px 7%;gap:20px}.brand{font:italic 34px Georgia,serif;letter-spacing:-2px}.brand span{display:block;font:10px -apple-system,sans-serif;letter-spacing:3px;margin:6px 0}nav{display:flex;gap:28px;font-size:12px}.hero{position:relative;padding:54px 7% 44px;overflow:hidden}.eyebrow{font-size:11px;letter-spacing:3px;color:#50766a}h1{font-size:clamp(32px,5vw,70px);letter-spacing:-2px;line-height:1.18;max-width:700px;font-weight:500;overflow-wrap:anywhere;margin:24px 0}.intro{font-size:15px;color:#52766b;line-height:1.8}.cta{display:inline-flex;gap:60px;padding:14px 20px;background:#244f42;color:white;margin:20px 0 40px;border-radius:4px;font-size:12px}.landscape{height:205px;background:#dfeee4;border-radius:120px 120px 8px 8px;position:relative;overflow:hidden}.sun{width:76px;height:76px;border-radius:50%;background:#dfb05e;position:absolute;top:28px;right:22%}.hill{position:absolute;width:85%;height:220px;border-radius:50%;background:#9fbea8;transform:rotate(-12deg);top:100px;left:-10%}.hill.front{background:#608c76;left:35%;top:122px;transform:rotate(15deg)}.landscape span{position:absolute;bottom:20px;left:28px;font-size:10px;color:white;letter-spacing:4px}.notes{margin:0 7%;padding:38px 0;display:grid;grid-template-columns:1fr 2fr;gap:30px;border-bottom:1px solid #d8e3dc}.notes>p{font-size:11px;letter-spacing:2px;color:#52766b}.notes h2{font-weight:500;font-size:22px;margin:0 0 16px}.notes div p,article{font-size:14px;line-height:1.9;color:#52766b}footer{font-size:10px;color:#52766b;letter-spacing:1px}article{padding:45px 7%;min-height:65vh}article h1{color:#203d36}article h2{font-weight:500}@media(max-width:520px){header,footer{padding:22px 6%}.hero{padding:25px 6%}.notes{grid-template-columns:1fr;gap:12px}nav{gap:15px}.landscape{height:165px}footer{flex-wrap:wrap}}`,
    },
  };
}

export const themePaths = Object.keys(sampleTheme().files);

// JSON strings are valid YAML scalars; user text cannot introduce YAML keys.
export function siteConfig(headline: string): string {
  return `site:
  name: bukitjalil-site
  title: ${JSON.stringify(headline)}
  language: zh-CN
  timezone: Asia/Kuala_Lumpur
  baseUrl: /
  analytics:
    enabled: false
  collections:
    page:
      permalink: /{slug}/
      template: pages/page.html
content:
  sources:
    - type: markdown
      name: pages
      mode: content
      collection: page
      markdown:
        dir: content
  media:
    downloadToLocal: false
build:
  output: dist
  followSymlinks: false
theme:
  name: canopy
`;
}

export const aboutPage = `---
title: 给好想法一个家
slug: about
type: page
collection: page
publishAt: 2026-01-01T00:00:00Z
---
我们相信，好的作品从一次小小的尝试开始。

## 慢慢来，也会生长

这是 Canopy 样例主题的关于页面。你正在浏览由 Bukit 真实构建的本地网站。
`;
