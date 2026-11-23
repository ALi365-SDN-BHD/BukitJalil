/**
 * The render check that runs inside a page (plan 14, borrowing from taste skill, D3). It is serialized with
 * Function.prototype.toString and run in the page, so it must not use anything from outside its own body.
 * It only reads the page, apart from moving focus to test the focus ring (and putting it back).
 */

export type RenderRule = "overflow" | "tap_target" | "headings" | "focus_ring" | "overlap";

export interface RenderIssue {
  rule: RenderRule;
  /** A short description of the element: tag, id or classes, and its text. */
  element: string;
  detail: string;
}

export interface RenderPageResult {
  /** The viewport width the page was checked at. */
  width: number;
  issues: RenderIssue[];
}

export function renderCheckPage(opts: { maxPerRule: number }): RenderPageResult {
  const issues: RenderIssue[] = [];
  const counts: Record<string, number> = {};
  const report = (rule: RenderRule, el: Element, detail: string) => {
    counts[rule] = (counts[rule] ?? 0) + 1;
    if (counts[rule] <= opts.maxPerRule) issues.push({ rule, element: nameOf(el), detail });
  };
  const width = window.innerWidth;
  // Transitions and animations would be caught midway (a focus ring fading in reads as no change).
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.append(freeze);

  function nameOf(el: Element): string {
    let name = el.tagName.toLowerCase();
    if (el.id) name += `#${el.id}`;
    else if (typeof el.className === "string" && el.className.trim())
      name += `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    return text ? `${name} "${text}"` : name;
  }
  function visible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  }
  /** Inside a box that scrolls or clips sideways, so it cannot widen the page. */
  function clipped(el: Element): boolean {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const x = getComputedStyle(p).overflowX;
      if (x === "auto" || x === "scroll" || x === "hidden" || x === "clip") return true;
    }
    return false;
  }
  const px = (n: number) => `${Math.round(n)}px`;

  // Overflow: the page is wider than the window; name the outermost elements that stick out.
  const doc = document.documentElement;
  if (doc.scrollWidth > width + 1) {
    let named = 0;
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right <= width + 1 || r.width === 0 || clipped(el)) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent.getBoundingClientRect().right > width + 1) continue;
      report("overflow", el, `Ends at ${px(r.right)} in a ${width}px window, so the page scrolls sideways.`);
      named++;
    }
    if (named === 0) report("overflow", document.body, `The page is ${doc.scrollWidth}px wide in a ${width}px window.`);
  }

  // Tap targets outside running text: at least 44px, unless nothing else is within 8px.
  const targets = [
    ...document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"]',
    ),
  ]
    .filter((el) => visible(el))
    .slice(0, 300);
  const inText = (el: Element) => {
    const parent = el.parentElement;
    if (!parent || getComputedStyle(el).display !== "inline") return false;
    const own = (el.textContent ?? "").trim().length;
    return (parent.textContent ?? "").trim().length > own;
  };
  const rects = targets.map((el) => el.getBoundingClientRect());
  targets.forEach((el, i) => {
    const r = rects[i] as DOMRect;
    if (Math.min(r.width, r.height) >= 44 || inText(el)) return;
    const near = rects.some((o, j) => {
      if (j === i || targets[j]?.contains(el) || el.contains(targets[j] as Element)) return false;
      const dx = Math.max(0, o.left - r.right, r.left - o.right);
      const dy = Math.max(0, o.top - r.bottom, r.top - o.bottom);
      return Math.hypot(dx, dy) < 8;
    });
    if (near)
      report("tap_target", el, `Is ${px(r.width)} × ${px(r.height)}, under 44px, with another target within 8px.`);
  });

  // Headings: one h1, and no level skipped on the way down.
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((el) => visible(el));
  const h1s = headings.filter((h) => h.tagName === "H1");
  if (h1s.length !== 1)
    report("headings", h1s[1] ?? document.body, `The page has ${h1s.length} visible h1 headings; it needs one.`);
  let previous = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (previous > 0 && level > previous + 1) report("headings", h, `Jumps from h${previous} to h${level}.`);
    previous = level;
  }

  // Overlap: blocks of the header, navigation, main content and footer that lie on one another.
  const blocks = [...document.querySelectorAll("header > *, nav > *, main > *, main > article > *, footer > *")]
    .filter((el) => visible(el) && getComputedStyle(el).position !== "fixed")
    .slice(0, 150);
  const boxes = blocks.map((el) => el.getBoundingClientRect());
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i] as Element;
      const b = blocks[j] as Element;
      if (a.contains(b) || b.contains(a)) continue;
      const ra = boxes[i] as DOMRect;
      const rb = boxes[j] as DOMRect;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && h > 2) report("overlap", a, `Lies on ${nameOf(b)} (${px(w)} × ${px(h)}).`);
    }
  }

  // Focus ring: focusing with focus-visible must change the outline or the box shadow. Last, because
  // focusing can run the page's own handlers, which may change the layout.
  const active = document.activeElement as HTMLElement | null;
  const x = window.scrollX;
  const y = window.scrollY;
  for (const el of targets.slice(0, 60) as HTMLElement[]) {
    if (typeof el.focus !== "function") continue;
    // Computed styles are live: read the look into a string before and after.
    const ring = (s: CSSStyleDeclaration) =>
      `${s.outlineStyle}|${s.outlineWidth}|${s.outlineColor}|${s.boxShadow}|${s.borderColor}|${s.backgroundColor}`;
    const was = ring(getComputedStyle(el));
    el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    if (document.activeElement !== el) continue;
    if (ring(getComputedStyle(el)) === was) report("focus_ring", el, "Shows no change when focused with the keyboard.");
    el.blur();
  }
  active?.focus?.({ preventScroll: true });
  window.scrollTo(x, y);

  freeze.remove();
  for (const [rule, n] of Object.entries(counts)) {
    if (n > opts.maxPerRule)
      issues.push({ rule: rule as RenderRule, element: "", detail: `${n - opts.maxPerRule} more not listed.` });
  }
  return { width, issues };
}
