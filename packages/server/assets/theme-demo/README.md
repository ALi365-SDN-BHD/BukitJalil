# Theme demo content

Sample content for theme projects (theme development design 3.4). It replaces the `content/` that
`bukit new` writes, so every page type has an example: home, posts, pages, the blog list with a second
page (12 posts, page size 10), tags, categories and search. Only `content/` is copied into a project.

Replace it with `bukit new --demo` once Bukit has it.

`design-system/` is BukitJalil's default design system (plan 14, theme design spec D1): `tokens.yaml`
follows the token contract in the `theme-design` skill, and `style.css` replaces the starter theme's
stylesheet. New and cloned theme projects start from it; imported themes keep their own.
