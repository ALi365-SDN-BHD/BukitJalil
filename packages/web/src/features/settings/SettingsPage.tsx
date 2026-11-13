import { useQueryClient } from "@tanstack/react-query";
import { Database, GraduationCap, Puzzle, Rocket, Search, Settings2, Sparkles, Wrench, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { DataSourceSection } from "./DataSourceSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { ExtensionsSection } from "./ExtensionsSection";
import { GeneralSection } from "./GeneralSection";
import { ModelSection } from "./ModelSection";
import { PublishingSection } from "./PublishingSection";
import { SkillsSection } from "./SkillsSection";
import { resolveSettingsSection, type SettingsSection } from "./useOpenSettings";

interface Item {
  id: SettingsSection;
  group: "preferences" | "integrations" | "computer";
  icon: ReactNode;
  label: string;
}

/** Settings as a page (plan 10.1): a searchable section list on the left, the section content on the right. */
export function SettingsPage() {
  const { m } = useI18n();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const raw = params.get("section");
  const section: SettingsSection = resolveSettingsSection(raw);
  const from = (location.state as { from?: string } | null)?.from;

  // Opening settings looks at the tools again: a fresh probe of the bundled Bukit (the server caches it),
  // ripgrep and Pi, put into the same queries the environment section reads.
  useEffect(() => {
    void (async () => {
      await queryClient.cancelQueries({ queryKey: keys.bukit });
      const data = await api.bukit(true);
      queryClient.setQueryData(keys.bukit, data);
    })().catch(() => {});
    void (async () => {
      await queryClient.cancelQueries({ queryKey: keys.rg });
      const data = await api.rg();
      queryClient.setQueryData(keys.rg, data);
    })().catch(() => {});
    void (async () => {
      await queryClient.cancelQueries({ queryKey: keys.pi });
      const data = await api.pi();
      queryClient.setQueryData(keys.pi, data);
    })().catch(() => {});
  }, [queryClient]);

  const items: Item[] = [
    {
      id: "general",
      group: "preferences",
      icon: <Settings2 className="size-4" />,
      label: m.settings.sections.general,
    },
    { id: "model", group: "preferences", icon: <Sparkles className="size-4" />, label: m.settings.sections.model },
    {
      id: "skills",
      group: "preferences",
      icon: <GraduationCap className="size-4" />,
      label: m.settings.sections.skills,
    },
    {
      id: "publishing",
      group: "integrations",
      icon: <Rocket className="size-4" />,
      label: m.settings.sections.publishing,
    },
    { id: "data", group: "integrations", icon: <Database className="size-4" />, label: m.settings.sections.data },
    {
      id: "extensions",
      group: "integrations",
      icon: <Puzzle className="size-4" />,
      label: m.settings.sections.extensions,
    },
    {
      id: "environment",
      group: "computer",
      icon: <Wrench className="size-4" />,
      label: m.settings.sections.environment,
    },
  ];
  const needle = query.trim().toLowerCase();
  const matches = (item: Item) => !needle || item.label.toLowerCase().includes(needle);
  const groups = (["preferences", "integrations", "computer"] as const)
    .map((id) => ({
      id,
      label: m.settings.groups[id],
      items: items.filter((item) => item.group === id && matches(item)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex h-dvh flex-col bg-muted/30 p-0 text-foreground md:p-4" data-testid="settings-page">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border bg-background md:rounded-xl md:shadow-lg">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 md:px-6">
          <h1 className="text-lg font-semibold" data-testid="settings-title">
            {m.settings.title}
          </h1>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={m.common.close}
            title={m.common.close}
            data-testid="settings-close"
            onClick={() => navigate(from ?? "/", { replace: true })}
          >
            <X />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label={m.settings.navigation}
            className="flex w-full shrink-0 flex-col border-b bg-muted/20 md:w-64 md:border-r md:border-b-0"
          >
            <div className="p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={query}
                  placeholder={m.settings.search}
                  aria-label={m.settings.search}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {groups.map((group) => (
                <div key={group.id} className="flex flex-col gap-0.5">
                  <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`settings-nav-${item.id}`}
                      aria-current={section === item.id ? "page" : undefined}
                      onClick={() =>
                        setParams(
                          (p) => {
                            const next = new URLSearchParams(p);
                            next.set("section", item.id);
                            return next;
                          },
                          { replace: true, state: location.state },
                        )
                      }
                      className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                        section === item.id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{m.settings.noResults}</p>}
            </div>
          </nav>
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-8">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
              {section === "general" && <GeneralSection />}
              {section === "model" && <ModelSection />}
              {section === "skills" && <SkillsSection />}
              {section === "publishing" && <PublishingSection />}
              {section === "data" && <DataSourceSection />}
              {section === "extensions" && <ExtensionsSection />}
              {section === "environment" && <EnvironmentSection />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
