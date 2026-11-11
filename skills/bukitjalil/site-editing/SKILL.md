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
  added by the user.
- Do not ignore new files in `.gitignore`: ignored files block `bukit_check`
  and `bukit_build`.
- Keep paths in `site.yaml` relative and inside the site, and do not set
  `content.media.blockPrivateNetworks: false`; the safety check refuses both.

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
retrying in a loop. If it says the site uses Notion, explain that Bukit cannot
check or build unreviewed changes for Notion sites, and continue with the
files.
