---
name: content-writing
description: Writing website content in BukitJalil - home page copy, about and service pages, FAQ, blog posts, SEO titles and descriptions, and the front matter conventions to follow.
---

# Content writing

## Before writing

- Call `list_content` and read one or two existing files of the same kind.
  Copy their front matter fields and order; do not invent fields.
- Check which collection a file belongs to (`site_info` shows collections and
  their permalinks). In the starter site, posts are in `content/posts`
  (collection `post`) and pages in `content/pages` (collection `page`).
- Write in the site's language (`site.languages`: its one entry, or each
  language of a multilingual site; see the `multilingual` skill). Ask if the user has not
  said who the site is for.

## Front matter

Typical fields in BukitJalil sites:

```yaml
---
collection: post
title: Opening our second shop
slug: second-shop
publishAt: "2026-03-01T09:00:00Z"
updatedAt: "2026-03-01T09:00:00Z"
summary: One or two sentences shown in lists and used for the description.
tags: [news]
categories: [shop]
---
```

- `slug`: lowercase words joined by hyphens, unique in the collection.
- Dates: quoted ISO 8601 with a time zone.
- `summary`: plain text, 120 to 160 characters works well for search results.
- Check `bukit-content` and `bukit-config` (or `bukit_schema`) before using a
  field you have not seen in the site.

## Pages people expect

- Home: who the business is, what it offers, for whom, and one clear next step
  (contact, visit, buy). Short paragraphs and headings.
- About: the story, the people, the place; concrete facts over adjectives.
- Services or products: one section per offer with what it is, who it is for
  and how to get it.
- FAQ: real questions in the customer's words, short direct answers, one
  question per heading.
- Contact: address, opening hours, phone or email the user gave you. Never
  invent contact details, prices, awards or customer quotes; leave a clear
  placeholder like `[phone number]` and tell the user.

## Read like a person wrote it

Generated copy reaches for the phrase that would fit any business. Each vague
word stands in for a fact: "seamless" for the setup steps, "robust" for what
happens when something fails, "powerful" for a figure. Replace it with the fact
the user gave you; without one, write a plainer line, never an invented detail.
One of the signs below proves little; several together, or one repeated, read
as machine-written. A word that is literal for the trade stays (a climbing
harness, bespoke tailoring), and so does the user's own wording.

In English (adapted from taste-skill's copy tells, MIT):

- Empty words: seamless, effortless, robust, powerful, cutting-edge,
  world-class, elevate, unlock, empower, leverage, delve, tapestry, realm,
  testament to, nestled, meticulous, game-changing, state-of-the-art.
- Stock lines: "In today's fast-paced world", "Unlock the power of", "Look no
  further", "Whether you're A or B", "It's not just X, it's Y", "Ready to
  transform your X?", "Join thousands of".
- Shapes: an "-ing" tail on a fact (", ensuring a smooth start"); the question
  answered at once ("The result? …"); "serves as" where "is" would do; "not X
  but Y" and its stand-ins "rather than", "instead of"; runs of "No X, no Y";
  two-fragment headings ("Twelve rooms. Three ways to stay.").
- Virtue words about yourself: honest, genuine, thoughtful, intentional,
  carefully, simply. Show it with a fact instead.
- Invented specifics and neat proof: "Room 9 at 6:12 a.m.", "3x faster",
  "10,000+ teams", a row of three figures under the heading, three polished
  testimonials, an origin story the user never told.
- The page talking about itself: "Below you'll find", "Here are 3 reasons".
- Punctuation: em dashes everywhere, exclamation marks in body text, emoji as
  bullets.

In Chinese:

- 空泛词：赋能、助力、打造、极致、匠心、一站式、全方位、无缝、颠覆、引领、
  深耕、生态、闭环、抓手、高端、品质生活。
- 套话：“在当今快速发展的时代”“随着……的不断发展”“不仅……更是……”
  “让我们一起……”“值得一提的是”“总而言之”“话不多说”“开启……新篇章”。
- 句式：每段都是“首先、其次、最后”；四字词排比三连；每个标题都是对仗的
  两句；“不是……而是……”反复出现；“没有……没有……只有……”。
- 夸自己的形容词：用心、真诚、专业、贴心、精心。换成一个能核实的事实。
- 编造的细节和数字：没出处的“服务超过 10000 位客户”“效率提升 3 倍”、
  标题下一排三四个数字、三条工整的好评。
- 标点：一句一个感叹号，大量破折号，emoji 当项目符号。

Don't over-correct: a ban breeds its substitute (no em dashes becomes comma
splices, no hype words becomes "quietly" and "steady", no threes becomes
everything in pairs). Plain "is" and "has", a list of three when there are
three things, and persuasion on a sales page that stands on facts are fine.

## SEO and GEO basics

- One `#` heading per page that matches the title.
- Titles under about 60 characters; put the important words first.
- Link related pages with relative links; give images useful `alt` text.
- See `bukit-seo` and `bukit-geo` for what Bukit generates automatically.
- `bukit_build` ends with `seoGeo`: SEO errors and warnings by kind, and the
  GEO score. Fix what your change caused or what the user asked about; do
  not chase every warning. Warnings that only say URLs are relative come
  from a missing `site.url` — set it only when the user gives the address.
  The GEO score rises when pages carry a `geo` block in their front matter,
  where it fits the content — an FAQ page, a how-to, a service page:

  ```yaml
  geo:
    schema_type: FAQPage        # or HowTo, Service, Article, Organization…
    faq:                        # each item needs both fields
      - question: How long does a project take?
        answer: Most projects take four to six weeks.
    steps:                      # for how-to content
      - name: Book a call
        text: Pick a time on the contact page.
  ```

  Only put facts the page itself states into `faq` and `steps`.

Finish with `bukit_check`, `bukit_build` and `summarize_changes` (see
`site-editing`).
