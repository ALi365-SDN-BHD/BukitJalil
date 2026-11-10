import type { DeployStatusResponse } from "@bukitjalil/shared";
import { isRecord } from "../bukit/guard.ts";
import type { PanelService } from "../panels/service.ts";
import type { SecretStore } from "../settings/secrets.ts";
import type { SiteService } from "../sites/service.ts";
import { deployTarget } from "./target.ts";

export interface DeployServiceOptions {
  sites: SiteService;
  panels: PanelService;
  secrets: SecretStore;
}

/** Publishing to GitHub Pages (plan 14 M6). */
export class DeployService {
  constructor(private readonly opts: DeployServiceOptions) {}

  /** The target in site.yaml on the default branch, and whether a publish can start. */
  async status(siteId: string): Promise<DeployStatusResponse> {
    const site = this.opts.sites.get(siteId);
    const { commit, config } = await this.opts.panels.config(siteId, "main");
    const target = deployTarget(isRecord(config) ? config : null);
    const token = this.opts.secrets.get("github") !== null;
    return { commit, target, token, ready: target.problem === null && token && site.readOnly === null };
  }
}
