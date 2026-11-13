---
name: publishing
description: Setting where a Bukit site is published from BukitJalil - the deploy section of site.yaml for GitHub Pages (repository, branch, custom domain). Use when the user asks to publish, deploy, or set up GitHub Pages.
---

# Publishing settings

You cannot publish. The user publishes from BukitJalil's Publish panel, and
sets the target there: **Deploy settings** picks a saved publishing account and
fills in the repository, branch and optional custom domain. The app checks the
account token's access and writes the `deploy` section and site address into
`site.yaml` as one config commit. Do not edit `deploy` for them and never put a
token or password in `site.yaml`.

## The deploy section

For reference, `deploy` is a top-level section, next to `site` (not inside it):

```yaml
deploy:
  provider: github-pages
  repo: owner/name
  branch: gh-pages
```

- `repo` is `owner/name` exactly as on GitHub, without `https://github.com/`
  or `.git`.
- `branch` is where the built site is pushed, `gh-pages` by default. GitHub
  Pages must be set to serve from that branch (repository Settings → Pages →
  Build and deployment → Deploy from a branch).
- `cname` only for a custom domain, as a bare host name such as
  `www.example.com`.

## The site address

The deploy settings also set `site.url` and `site.baseUrl` for the chosen
repository, so canonical links, the sitemap and RSS are absolute. If the user
changes the target by hand, keep them in step:

- a repository named `owner.github.io`: `https://owner.github.io`, base `/`
- any other repository: `https://owner.github.io/name`, base `/name/`
- a custom domain: `https://www.example.com`, base `/`

## Checking

Run `bukit_check` and `bukit_build` after editing, then explain in
`summarize_changes` what changed. Publishing itself, the repository target and
the token are handled in the app.
