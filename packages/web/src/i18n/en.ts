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
    "bukit.install_running": "Bukit is already being installed",
    "bukit.unsupported_platform":
      "There is no official Bukit package for this platform; build Bukit yourself and set its path in Settings",
    "fs.not_found": "This folder does not exist",
    "fs.not_directory": "This path is not a folder",
    "fs.permission_denied": "No permission to open this folder",
    "site.not_found": "This site no longer exists",
    "site.busy": "The site is busy with another operation; try again shortly",
    "site.identity_required": "Fill in the commit name and email in Settings first",
    "site.path_forbidden": "This location cannot hold a site: {reason}",
    "site.path_not_empty": "The folder must be new or empty",
    "site.path_overlaps_site": "This location overlaps the site {site}",
    "site.already_registered": "This folder is already a BukitJalil site",
    "site.no_site_yaml": "This folder has no site.yaml, so it is not a Bukit site",
    "site.not_repo_root": "The folder is inside a git repository; choose the repository's top folder",
    "site.not_git": "This folder is not a git repository yet",
    "site.no_commits": "The git repository has no commits yet; commit once and try again",
    "site.detached_head": "The repository is not on a branch; switch to a branch and try again",
    "site.bad_branch": "The current branch name is not supported",
    "site.dirty": "The repository has uncommitted changes; commit or discard them first",
    "site.nested_repo": "The folder contains another git repository: {path}",
    "site.too_many_files": "The folder has more than {max} files to commit; add a .gitignore first",
    "site.file_list_changed": "The files changed after you reviewed them; check the list again",
  },
};

export default en;
