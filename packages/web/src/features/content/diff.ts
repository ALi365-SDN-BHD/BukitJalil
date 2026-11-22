/** A line of a body diff: kept, removed or added. */
export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
}

/** Above this many line pairs the table would be too large to build: the whole body shows as replaced. */
const MAX_CELLS = 4_000_000;

/**
 * The lines of `after` against `before` (the proposal card's body change), by longest common subsequence.
 * Lines kept at both ends are matched first, so a change in a long body costs only its middle.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const same = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: "same", text }));
  const head = same(a.slice(0, start));
  const tail = same(a.slice(endA));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const removed = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: "removed", text }));
  const added = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: "added", text }));
  if (midA.length * midB.length > MAX_CELLS) return [...head, ...removed(midA), ...added(midB), ...tail];

  // lengths[i][j]: the longest common subsequence of midA[i..] and midB[j..], one row of midB per line.
  const n = midA.length;
  const m = midB.length;
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = lengths[i] as Uint32Array;
    const below = lengths[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--)
      row[j] = midA[i] === midB[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number);
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: "same", text: midA[i] as string });
      i++;
      j++;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) {
      middle.push({ kind: "removed", text: midA[i++] as string });
    } else {
      middle.push({ kind: "added", text: midB[j++] as string });
    }
  }
  return [...head, ...middle, ...removed(midA.slice(i)), ...added(midB.slice(j)), ...tail];
}
