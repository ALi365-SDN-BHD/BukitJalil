import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki/core";
import { type Lang, MAX_HIGHLIGHT_CHARS, tokenize } from "@/lib/highlight";

/** Is the page in dark mode? Follows the class main.tsx sets from the system setting. */
function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Read-only code with line numbers; highlighted when the language is known and the file is not huge. */
export function CodeView({ code, lang }: { code: string; lang: Lang | null }) {
  const dark = useDark();
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    setTokens(null);
    if (!lang || code.length > MAX_HIGHLIGHT_CHARS) return;
    let cancelled = false;
    tokenize(code, lang, dark)
      .then((t) => !cancelled && setTokens(t))
      .catch(() => {
        // Plain text is a fine fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, dark]);

  const lines = tokens ?? code.split("\n").map((line) => [{ content: line, offset: 0 } as ThemedToken]);
  return (
    <pre className="overflow-auto p-3 font-mono text-xs leading-5" data-testid="code-view">
      <code className="grid grid-cols-[max-content_1fr] gap-x-4">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          <Line key={i} n={i + 1} tokens={line} />
        ))}
      </code>
    </pre>
  );
}

function Line({ n, tokens }: { n: number; tokens: ThemedToken[] }) {
  return (
    <>
      <span className="select-none text-right text-muted-foreground/60">{n}</span>
      <span className="whitespace-pre">
        {tokens.map((t, i) => (
          // React sets colors through the CSSOM, which the CSP allows (inline style attributes are blocked).
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
          <span key={i} style={t.color ? { color: t.color } : undefined}>
            {t.content}
          </span>
        ))}
        {"\n"}
      </span>
    </>
  );
}
