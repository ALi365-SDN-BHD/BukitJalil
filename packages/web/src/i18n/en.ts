import type { Messages } from "./zh-CN.ts";

const en: Messages = {
  app: {
    name: "BukitJalil",
  },
  sidebar: {
    title: "Sites",
    empty: "No sites yet",
    newSite: "New site",
    importSite: "Import site",
  },
  conversation: {
    title: "Conversation",
    placeholder: "Pick a site to start talking with the AI",
  },
  panel: {
    title: "Panels",
    preview: "Preview",
    changes: "Changes",
    files: "Files",
    config: "Config",
    theme: "Theme",
    data: "Data",
    empty: "Pick a site to see its {panel} here",
  },
  status: {
    checking: "Checking the environment…",
    gitOk: "git {version}",
    gitMissing: "git was not found",
    gitTooOld: "git {version} is too old; 2.38 or newer is required",
    unreachable: "Cannot reach the BukitJalil server",
  },
  settings: {
    language: "Language",
    saveFailed: "Could not save: {reason}",
  },
  errors: {
    "auth.required": "Your session has expired. Press Enter in the terminal running BukitJalil and open the new link.",
    "request.bad_host": "This address is not allowed",
    "request.bad_origin": "This request origin is not allowed",
    "request.bad_content_type": "Malformed request",
    "request.missing_csrf_header": "The request is missing its security header",
    "request.cors_not_allowed": "Cross-origin requests are not allowed",
    "request.invalid_body": "Invalid request content",
    "request.not_found": "Unknown endpoint",
    "server.internal": "Internal server error",
  },
};

export default en;
