---
collection: post
title: Showing code on a page
slug: code-blocks
publishAt: "2026-01-22T08:00:00Z"
updatedAt: "2026-01-22T08:00:00Z"
summary: A post with code blocks, for checking how a theme shows them.
tags: [code]
categories: [guides]
---

Inline code looks like `bukit build`. A longer example goes in a block:

```yaml
theme:
  name: my-theme
  params:
    brand: My site
```

```js
function greet(name) {
  return `Hello, ${name}!`;
}
```

Long lines in a block should scroll sideways instead of breaking the layout: `a-very-long-identifier-that-keeps-going-and-going-and-going-past-the-edge`.
