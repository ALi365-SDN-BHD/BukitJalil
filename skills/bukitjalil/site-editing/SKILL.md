---
name: site-editing
description: How to work on a site in BukitJalil - tools to use instead of Bukit commands, what you may change, and the check, build and summary steps. Read it before changing any file.
---

# Site editing in BukitJalil

You work in a private copy of the user's site. The user reviews your changes
before they reach the site, so make focused changes that are easy to review.

## Tools instead of commands

You cannot run commands. Bukit's skills describe commands; use these tools:

| Bukit command | Tool |
|---|---|
| `bukit config check`, `bukit doctor` | `bukit_check` |
| `bukit build` | `bukit_build` (temporary output; no preview) |
| `bukit config schema` | `bukit_schema` (pass a section such as `site` or `theme`) |
| `bukit preview`, `bukit dev`, `bukit clean` | none: BukitJalil shows previews |
| `bukit deploy`, `bukit publish`, audits | none: the user publishes from BukitJalil |

Plugins beyond Bukit's built-in `site.plugins` switches, Labs features and
remote themes are not available.

Other tools: `site_info` summarizes `site.yaml`; `list_content` lists Markdown
files with their front matter; `read`, `ls`, `find`, `grep`, `edit` and
`write` work on files in the working directory.

## What you may change

- Use paths relative to the working directory. Everything outside it is off
  limits, except reading skill files.
- You cannot write `.git`, `dist`, `.bukit`, `.cache`, `.bukitjalil-build`,
  `plugins/`, `node_modules`, `plugin.yaml`, `plugin.json` or `.env*` files.
- You can only write text files up to 1 MB. Images and other binary files are
  added by the user; never create them yourself.
- Do not ignore new files in `.gitignore`: ignored files block `bukit_check`
  and `bukit_build`.
- Keep paths in `site.yaml` relative and inside the site, and do not set
  `content.media.blockPrivateNetworks: false`; the safety check refuses both.
- `site.yaml` is one YAML document. Bukit reads only the part before the
  first `...` or `---` line and ignores the rest without an error, so the
  safety check refuses a second document. Put new settings inside the
  existing sections, never below such a line, and never add one.

## Uploaded images and files

The user can upload images and PDFs into the current theme's `static/uploads/`.
`site_info` returns them under `media.files`; use the exact names it gives you.

- In Markdown and front matter, use each file's `url` as returned by `site_info`
  (it already includes `site.baseUrl`).
- In a theme template, use `{{ site.base_url }}/uploads/<file name>`; the starter
  also defines `base_url`, so `{{ base_url }}/uploads/<file name>` works there.
  Do not append a base URL to a `url` that already has one.
- Write meaningful `alt` text for images. A wrong file name still builds, but
  the page shows a broken image; use the name from `site_info` instead of guessing.
- Do not move, rename or delete files in `static/uploads/`. If the user changes
  the theme or `site.baseUrl`, warn them that existing media links may stop
  working before making the change.
- Do not open a file whose `viewable` field is false (for example a PDF) with the
  read tool. Ask the user to upload an image when one is missing.

## Steps

1. Start with `site_info`; use `list_content` when the task is about content.
   Read the files you are going to change.
2. Make the change. Follow the conventions already in the site (front matter
   fields, file names, theme structure) rather than inventing new ones.
3. Run `bukit_check`. Fix what it reports and run it again until it passes.
4. Run `bukit_build`. Fix errors; mention warnings you could not fix.
5. Call `summarize_changes` with a few sentences for the user: what changed and
   why, and anything they should look at.

If a tool says the site is busy, wait for the user's next message instead of
retrying in a loop.

For a Notion site, `bukit_check` and `bukit_build` read the Notion data saved
by the user's last main build (`notionData` in the result says when): no token,
no network, so Notion edits made since then do not show. If a tool says there
is no such data yet, or that the change uses a Notion database the main build
did not read, tell the user what it says and continue with the files. The
Notion token belongs to the data source chosen when the site was created;
never put a token in `site.yaml`.
