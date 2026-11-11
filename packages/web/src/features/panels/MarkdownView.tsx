import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Split leading YAML front matter ("---" … "---") from a Markdown body. */
export function splitFrontMatter(text: string): { frontMatter: string | null; body: string } {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const match = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  return match ? { frontMatter: match[1] ?? "", body: src.slice(match[0].length) } : { frontMatter: null, body: src };
}

/**
 * Rendered Markdown (react-markdown with GitHub Flavored Markdown, as Bukit renders it: raw HTML in the source is not rendered, and unsafe link protocols are
 * dropped). Images are shown as their alt text: they point at the site's own paths, which only the preview
 * port serves, and loading them here would only produce errors.
 */
export function MarkdownView({ body, className = "p-4" }: { body: string; className?: string }) {
  return (
    <div className={`markdown-body max-w-none text-sm leading-6 ${className}`} data-testid="markdown-view">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Site-relative links point into the built site, not the admin UI, so only absolute ones open.
          a: ({ node: _, href, children }) =>
            href && /^(https?:|mailto:)/i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span className="underline decoration-dotted" title={href}>
                {children}
              </span>
            ),
          img: ({ alt, src }) => (
            <span
              className="rounded border px-1 text-xs text-muted-foreground"
              title={typeof src === "string" ? src : undefined}
            >
              🖼 {alt || src}
            </span>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
