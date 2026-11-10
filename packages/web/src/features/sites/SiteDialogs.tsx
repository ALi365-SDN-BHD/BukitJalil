import type { Site } from "@bukitjalil/shared";
import { useNavigate } from "react-router";
import { ImportDialog } from "./ImportDialog";
import { NewSiteDialog } from "./NewSiteDialog";

export type SiteDialog = "new" | "import" | null;

/** The "new site" and "import site" dialogs; a created or imported site is opened. */
export function SiteDialogs({ dialog, onClose }: { dialog: SiteDialog; onClose: () => void }) {
  const navigate = useNavigate();
  const goTo = (site: Site) => navigate(`/sites/${site.id}`);
  // Mounted only while open, so each opening starts empty.
  if (dialog === "new") return <NewSiteDialog open onOpenChange={(o) => !o && onClose()} onCreated={goTo} />;
  if (dialog === "import") return <ImportDialog open onOpenChange={(o) => !o && onClose()} onImported={goTo} />;
  return null;
}
