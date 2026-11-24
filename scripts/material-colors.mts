/**
 * The colors of the Material design system (plan 14, borrowing from Material 3, D7): Material 3's color
 * roles for one seed color, in the light and dark schemes, mapped to the token contract. Run it when the
 * seed changes and copy the output into packages/server/assets/theme-demo/design-system-material/
 * (tokens.yaml `colors`, and the dark block of style.css):
 *
 *   packages/server/node_modules/.bin/tsx scripts/material-colors.mts [#seed]
 *
 * @material/material-color-utilities (Apache-2.0) is a dev dependency: themes only get the hex values. Its
 * ESM build imports without file extensions, so it runs through tsx, not plain node.
 */
import {
  argbFromHex,
  type DynamicColor,
  Hct,
  hexFromArgb,
  MaterialDynamicColors as M,
  SchemeTonalSpot,
} from "@material/material-color-utilities";

/** A blue-green: Material's baseline seed #6750A4 is violet, which theme_lint reports (rule `violet`). */
const SEED = process.argv[2] ?? "#1f6f8b";

/** Our token keys and the Material 3 role each takes; the code colors stay those of the default system. */
const ROLES: [string, DynamicColor][] = [
  ["bg", M.surface],
  ["surface", M.surfaceContainerLow],
  ["text", M.onSurface],
  ["muted", M.onSurfaceVariant],
  ["border", M.outlineVariant],
  ["border-strong", M.outline],
  ["accent", M.primary],
  ["accent-text", M.onPrimary],
  ["link", M.primary],
  ["focus", M.primary],
];

for (const dark of [false, true]) {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(SEED)), dark, 0);
  console.log(dark ? "\n/* dark: style.css */" : `# light: tokens.yaml (seed ${SEED})`);
  for (const [key, role] of ROLES) {
    const hex = hexFromArgb(role.getArgb(scheme));
    console.log(dark ? `--color-${key}: ${hex};` : `${key}: "${hex}"`);
  }
}
