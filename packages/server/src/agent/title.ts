/**
 * A short title from the first user message. Deterministic and free: a model call just for a sidebar
 * label would cost tokens and fail without a configured model. Manual rename overrides it.
 */
export function autoTitle(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith("```"));
  if (!line) return null;
  const clean = line
    .replace(/^[#>*\-\s]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[.。!！?？;；:：]+$/u, "")
    .trim();
  if (!clean) return null;
  const chars = [...clean];
  return chars.length <= 40 ? clean : `${chars.slice(0, 39).join("").trimEnd()}…`;
}
