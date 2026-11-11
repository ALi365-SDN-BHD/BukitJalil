---
name: publishing
description: Setting where a Bukit site is published from BukitJalil - the deploy section of site.yaml for GitHub Pages (repository, branch, custom domain). Use when the user asks to publish, deploy, or set up GitHub Pages.
---

# Publishing settings

You cannot publish. The user publishes from BukitJalil's Publish panel, after
the change that sets the target is reviewed and applied. Your part is the
`deploy` section of `site.yaml`; ask `bukit_schema` for the `deploy` section if
unsure of the fields in this Bukit version.

## The deploy section

`deploy` is a top-level section, next to `site` (not inside it):

```yaml
deploy:
  provider: github-pages
  repo: owner/name
  branch: gh-pages
```

- `repo` is required by BukitJalil: `owner/name` exactly as on GitHub, without
  `https://github.com/` or `.git`. Take it from the user; never guess it.
- `branch` is where the built site is pushed. Leave it at `gh-pages` unless the
  user names another branch. Tell the user that GitHub Pages must be set to
  serve from that branch (repository Settings → Pages → Build and deployment →
  Deploy from a branch).
- `cname` only when the user has a custom domain, as a bare host name such as
  `www.example.com`.
- Never put a token or password in `site.yaml`; the token is set in
  BukitJalil's settings.

## The site address

Set `site.url` to where the site will be served, so canonical links, the
sitemap and RSS are absolute:

- a repository named `owner.github.io`: `https://owner.github.io`
- any other repository: `https://owner.github.io/name`, and `site.baseUrl` to
  `/name/` so links work under that folder
- a custom domain: `https://www.example.com`

Keep `site.baseUrl` at `/` for the first and last case.

## Checking

Run `bukit_check` and `bukit_build` after editing, then explain in
`summarize_changes` which repository and branch the site will be published to,
and what the user must still do on GitHub (Pages source, the token's access to
the repository).
