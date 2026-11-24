---
name: theme-design
description: BukitJalil's design rules for any Bukit theme - the design direction to agree first, the token contract, the components and their states, Chinese typography, the design self-check and the strict rule against an AI-generated look. Read it before changing how a theme looks, in a theme project or in a site.
---

# Theme design in BukitJalil

These rules apply whenever you change how a theme looks: always in a theme
project, and in a site whenever you change its theme's layouts, CSS, tokens or
static pages. `theme-development` covers the theme project itself (layout,
page types, order of work); this skill covers the design.

You cannot see the preview. Check your work in the source: `tokens.yaml`, the
CSS and the templates.

## The design systems

New and cloned theme projects start from one of BukitJalil's design systems:
`themes/<name>/tokens.yaml` filled in by the token contract below, and
`themes/<name>/assets/style.css` written for the starter's markup with only
token variables, a dark scheme and every component state. It passes the
design self-check as it is. Build on it: change token values and the rules
the design direction needs, keep what already works. An imported theme keeps
its own files.

There are two, and the comment at the top of `tokens.yaml` says which one the
theme started from. The default one is neutral. The Material one follows
Material Design 3: large rounded corners, pill buttons and navigation, tonal
cards on the surface color instead of borders and shadows, and state layers
(8% of the content color on hover, 10% on focus and press). In a theme that
started from Material, keep those traits when you change the look, unless the
user asks for something else. A user can choose Material only for a new theme
made from a description; cloned themes start from the default one.

Material fits sites that should feel like an app: large rounded corners, pill
buttons, tonal cards, clear state colors. The default one fits sites that are
mostly text and should feel quiet or editorial, such as a classic blog. In a
new theme made from a description, the design direction says which system
fits (see below). `theme_design_system` switches the theme to the other one:
it writes that system's `tokens.yaml` and `assets/style.css` in place of the
theme's, and only while both are still the bundled originals. Once the look
has been changed it refuses; tell the user that switching would lose those
changes, and keep the current one unless they want to start over.

## Design direction

Before you write tokens for a new look, write a short design direction for the
user, five or six lines:

- who the site is for and what it should feel like
- colors: the neutrals and the one accent
- fonts: body and headings (system font stacks or font files in the theme)
- layout: how the home page and articles are arranged
- what the design will not do
- design system, in a new theme made from a description only: which one the
  theme started from, and which fits the description and reference images
  better and why. When both fit, keep the current one. Not for cloned themes
  (their project has `_capture/`) or imported ones.

When the user agrees to the other design system, call `theme_design_system`
before writing tokens, then build on its files. When the user said to finish
in one go, pick the system yourself, switch if needed, and say which one and
why in `summarize_changes`.

In a theme project, when the user has given no colors, reference images or
site to clone, call `theme_palettes` (with the kind of business as `trade`
when one fits) and offer its three palettes in the color line: each name with
one line from its note. The user picks one, or asks for others (`exclude` the
ids already offered), or describes their own; when the user said to finish in
one go, take the first. Its colors already meet every
contrast pair of group 2 in both schemes; the tool says where they go. You may
still adjust a color, as long as `theme_lint` stays clean.

Ask the user to confirm it or say what to change, and wait. Skip this when the
user said to finish in one go, when the change keeps the current look (fixing
a page, adding a template), or when the user asked for one specific change
(another accent color, a different font). Base the direction on the user's
description and reference images. Words like "modern", "premium", "sleek" or
"techy" describe a feeling; they don't ask for gradients or glass (see group 5
below).

## Token contract

`themes/<name>/tokens.yaml` must define at least these keys. A theme may add
its own. Bukit writes every key to `/assets/css/theme-tokens.css` as
`--<group>-<key>` (for example `colors.accent-text` becomes
`--color-accent-text`, `font.size-lg` becomes `--font-size-lg`); link that
file in the base layout before the theme's own CSS.

| Group | Keys |
|---|---|
| `colors` | `bg`, `surface`, `text`, `muted`, `border` (dividers and decorative borders), `border-strong` (borders people must see, such as inputs: at least 3:1 against `bg` and `surface`), `accent`, `accent-text` (text on the accent), `link`, `focus`, `code-bg`, `code-text` |
| `font` | `body`, `heading`, `mono` (font stacks); `size-sm`, `size-base`, `size-lg`, `size-xl`, `size-2xl`, `size-3xl` (in `rem`); `leading-body`, `leading-heading` |
| `spacing` | `1` to `8`: 4, 8, 16, 24, 32, 48, 64 and 96px, written in `rem` |
| `radius` | `sm`, `md`, `lg` |
| `layout` | `content` (article width, about `65ch`), `wide` (page width) |

Use the variables everywhere instead of literal values. The tokens hold one
set of colors. For a dark color scheme, redefine the same `--color-*`
variables in one `@media (prefers-color-scheme: dark)` block in the CSS, and
nowhere else. Palettes that belong to the content, Notion's text colors and
code highlighting, may stay literal; keep them together at the end of the CSS.

## Components and their states

A theme has these components. Each needs the states listed.

| Component | States |
|---|---|
| Header and navigation | current page marked; on narrow screens the navigation still works without JavaScript |
| Links and buttons | hover (inside `@media (hover: hover)`), `:focus-visible`, disabled where it applies |
| Skip link | hidden until focused |
| Post card or list item | title, date, summary; hover and focus on the link |
| Post meta | date, tags, categories; dates and other numbers that line up use `font-variant-numeric: tabular-nums` |
| Tags and categories | the same chip or link style everywhere |
| Pagination | current page, previous and next; a missing previous or next is left out or plain text, never a dead link |
| Search box and results | focus, no results, results |
| Article text | headings, paragraphs, lists, blockquote, table, code and code block, image and caption, horizontal rule |
| Footer | links with focus |
| 404 page | a message and a link home |

In a theme project, check the article text against `/pages/style-guide/`,
which shows every common element.

## Chinese text

When the site has Chinese pages:

- Put Chinese fonts in the font stacks: `"PingFang SC"`, `"Hiragino Sans GB"`,
  `"Microsoft YaHei"`, `"Noto Sans CJK SC"`, after the Latin fonts and before
  the generic family.
- Chinese body text needs more line height, 1.7-1.8 (for example under
  `:lang(zh)`).
- Don't use italics for Chinese: style `em` in Chinese text as bold or with
  `text-emphasis`.
- Leave the spacing between Chinese and Latin text to the content; don't add
  it with CSS.

## Design self-check

Go through this check before you ask the user to confirm a look, and again
before you finish. Fix what fails. If you leave something on purpose, say what
and why in `summarize_changes`.

In a theme project, run `theme_lint` first. It tests what a program can: the
token contract, the contrast of hex token colors in both schemes, literal
colors, resources from other sites, `:focus-visible`, reduced motion,
`transition: all`, gradient text, frosted glass, emoji, violet theme colors,
content revealed on scroll and tilt. Fix what it reports,
then check the rest yourself; an empty result does not mean the check passed.
In the desktop app, `theme_render_check` then renders the pages at 320, 390,
768 and 1280px and reports sideways scrolling, tap targets, headings, focus
rings and overlapping blocks (groups 2 and 3); fix what the templates cause.
The user sees the same warnings when they apply the theme to a site.

Go through the groups in order, and don't polish a later group while an
earlier one fails. In group 4, the user's request and the reference images
come first. Group 5 is strict and has its own rule for user requests. Groups
1-3 apply even then; if the user asks for something that fails one of them, or
their own site does, keep their choice and name the failing check in
`summarize_changes`.

1. **Content.** Every section on a page has a job; no filler sections.
   Templates don't hard-code page copy such as headlines and paragraphs
   (interface labels and the text of the search and 404 pages are fine), and
   nothing invents numbers, testimonials, client logos or contact details (see
   `content-writing`). The interface text a template does carry (the search
   and 404 pages, empty states, button labels) follows "Read like a person
   wrote it" in `content-writing`. One `h1` per page, and headings go down one level at a
   time. Structure says something true about the content: numbered markers
   (01, 02, 03), small labels and dividers only where the content really is a
   sequence or has those groups, never as decoration.
2. **Readable.**
   - Text contrast at least 4.5:1 against its background; 3:1 for text 24px
     and larger (or 18.66px bold), for borders that mark out inputs and
     buttons (`border-strong`, not `border`), and for focus outlines. Work it
     out from the colors in `tokens.yaml` and in the CSS (the tokens hold only
     one set of colors; a dark color scheme, mixed colors and code blocks are
     in the CSS) for every pair the theme uses: body text, muted text, links,
     text on the accent color, code, the footer, strong borders, in both light
     and dark schemes when there are two.
   - Body text `1rem`-`1.125rem` (16-18px) with line-height 1.5-1.7 (Chinese
     1.7-1.8); headings line-height 1.1-1.3. Font sizes in `rem`, so the
     reader's zoom works.
   - Article text no wider than about `65ch`.
   - Four to six font sizes in all, the `font.size-*` tokens. The home page
     `h1` is clearly larger than the next size down.
3. **Usable.**
   - Links, buttons and inputs have a `:focus-visible` style. Never
     `outline: none` without one.
   - Links in running text are underlined, not shown by color alone.
   - Navigation links, buttons and pagination are at least 44px tall (padding
     counts).
   - Hover effects sit inside `@media (hover: hover)`.
   - Transitions are 300ms or less and not `transition: all`. Transitions and
     animations are turned off in `@media (prefers-reduced-motion: reduce)`.
   - At 320px wide the page doesn't scroll sideways: code blocks and wide
     tables scroll inside their own box (`overflow-x: auto`), long words and
     URLs in content wrap (`overflow-wrap: break-word`), and images have
     `max-width: 100%; height: auto`. The navigation works without
     JavaScript. Inputs use at least 16px text.
4. **Consistent.**
   - Every key of the token contract exists, and colors, fonts, radii and
     spacing come from the variables, not literal values (the dark scheme
     block and the content palettes are the exceptions).
   - One spacing scale, the `spacing` tokens: gaps inside a group are smaller
     than gaps between groups, and those are smaller than gaps between
     sections.
   - Mostly neutral colors and one accent, used for links, the main action and
     a few highlights.
   - Every component in the table above has its states and looks the same on
     every page type.
5. **No AI look.** This group is strict: the theme must not look
   AI-generated. Never use any of the following on your own, and don't carry
   them over from reference images or a captured site:
   - rows of identical icon-heading-text cards that fill space
   - violet or lavender as the accent, background or in gradients
     (purple-to-blue), neon gradients, gradient text, glowing blobs, frosted
     glass, dark backgrounds with neon accents
   - cards or sections that fade or slide in as the page scrolls (without
     JavaScript, or with reduced motion, they may never appear), cards that
     tilt on hover
   - emoji as icons, headings and navigation in capitals
   - a small pill badge above the hero headline, a tiny label above every
     section heading
   - a centered hero with a big headline and two buttons as the default
     layout; everything centered
   - cards inside cards, the same large radius and soft shadow everywhere, an
     accent-colored bar down the side of rounded cards
   - the stock palettes of generated pages: warm cream with a serif display
     face and a terracotta accent; near-black with a single acid-green or
     vermilion highlight; newspaper-style hairline rules over dense columns
   - buttons that say "Learn more" or "Get started" (in any language) when the
     page has a real action to name

   If the user names one of these in the conversation and asks for it, first
   tell them it is a common sign of AI-generated design and ask them to
   confirm. Use it only after they confirm, and only what they named.

   If something would look good in a screenshot but makes the page harder to
   read or use, leave it out.
