import { BUKIT_BUILTIN_PLUGINS, BUKIT_PLUGIN_CONFIG } from "@bukitjalil/shared";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/** Settings → Extensions: what Bukit's built-in plugins are. Switches live in each site's Config panel. */
export function ExtensionsSection() {
  const { m } = useI18n();
  const p = m.bukitPlugins;
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={p.title} description={p.description}>
        {BUKIT_BUILTIN_PLUGINS.map((plugin) => {
          const item = p.items[plugin.id];
          const stages = plugin.stages.map((stage) => p.stages[stage]).join(" · ");
          return (
            <SettingsRow
              key={plugin.id}
              testId={`extension-${plugin.id}`}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {item.name}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {plugin.id}
                  </code>
                </span>
              }
              description={
                <span className="flex flex-col gap-1">
                  <span>{item.description}</span>
                  <span className="text-[11px]">
                    {stages} · {BUKIT_PLUGIN_CONFIG[plugin.id].join(" · ")}
                  </span>
                </span>
              }
            >
              <Badge tone="neutral">{p.defaultOn}</Badge>
              <span className="text-xs text-muted-foreground">{p.settingsHint}</span>
            </SettingsRow>
          );
        })}
      </SettingsSection>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{p.settingsNote}</p>
        <p>{p.externalNote}</p>
      </div>
    </div>
  );
}
