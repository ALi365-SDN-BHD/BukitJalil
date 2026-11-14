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
