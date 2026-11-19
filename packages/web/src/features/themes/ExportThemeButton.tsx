import type { Theme } from "@bukitjalil/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { ApiRequestError, themeExportUrl } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";

/**
 * Export the theme project's default branch as a zip (theme development design 7). The desktop app asks
 * where to save it; a browser downloads it the usual way. Sample content and reference images are not in it.
 */
export function ExportThemeButton({ theme }: { theme: Theme }) {
  const { m, errorOf } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(themeExportUrl(theme.id));
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string; params?: Record<string, string> } | null;
        throw new ApiRequestError(
          res.status,
          (body?.code ?? "server.internal") as ConstructorParameters<typeof ApiRequestError>[1],
          body?.params,
        );
      }
      const data = await (await res.blob()).arrayBuffer();
      const bridge = desktopBridge();
      if (bridge) {
        await bridge.saveFile(`${theme.themeName}.zip`, data);
        return;
      }
      const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${theme.themeName}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || theme.readOnly !== null}
        onClick={() => void run()}
        data-testid="export-theme"
      >
        <Download /> {m.themes.export}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(error)}
        </p>
      )}
    </div>
  );
}
