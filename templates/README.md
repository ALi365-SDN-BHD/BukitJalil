# templates

`starter/` is copied into every new site (plan 5.2). It is generated, not edited by hand:

```bash
BUKIT_SRC=/path/to/Bukit/clone scripts/make-starter.sh
```

The script copies Bukit's StarterTheme resources (MIT, `src/Bukit-Core/Bukit.Cli/Resources/StarterTheme`)
from the tag in `BUKIT_TAG` (default `v2.0.11`), adds sample content and `site.yaml`, and records the
source commit in `starter.source.json`. Keep `starter/` a plain Bukit project: no BukitJalil files.

After regenerating, build it with the real Bukit:

```bash
BUKIT_BIN=/path/to/bukit pnpm test packages/server/test/template.test.ts
```

Biome does not touch this directory: formatting would break the template syntax.
