/** GET /api/pi: the Pi runtime bundled with this app and the latest release on npm. */
export interface PiStatus {
  /** The bundled Pi version; Pi ships inside the app, so this changes only with a new app release. */
  version: string;
  /** The latest `@earendil-works/pi-coding-agent` release, or null when the check was skipped or failed. */
  latestVersion: string | null;
  updateAvailable: boolean;
}
