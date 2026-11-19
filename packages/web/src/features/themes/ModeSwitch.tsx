import { Globe, Palette } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { type Mode, modeOf } from "@/lib/project";

const LAST_KEY: Record<Mode, string> = { site: "bj-last-site", theme: "bj-last-theme" };
const HOME: Record<Mode, string> = { site: "/", theme: "/themes" };

/** The remembered place of a mode; only a path of that mode is taken (local storage can hold anything). */
export function lastLocation(mode: Mode): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LAST_KEY[mode]);
  } catch {
    // privacy modes: start at the mode's home
  }
  if (!stored?.startsWith("/") || stored.startsWith("//") || modeOf(stored.split(/[?#]/)[0] ?? "") !== mode) {
    return HOME[mode];
  }
  return stored;
}

/** Remember where the user is in each mode, so switching back returns there (design 2). */
export function useRememberLocation(): Mode {
  const location = useLocation();
  const mode = modeOf(location.pathname);
  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_KEY[mode], `${location.pathname}${location.search}`);
    } catch {
      // only a convenience
    }
  }, [mode, location.pathname, location.search]);
  return mode;
}

/**
 * The two-segment switch at the top of the left column (design 2), like a desktop app's mode toggle: icon and
 * label, icon only when the column is narrow.
 */
export function ModeSwitch() {
  const { m } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const current = modeOf(location.pathname);
  const segments: { mode: Mode; label: string; icon: React.ReactNode }[] = [
    { mode: "site", label: m.mode.site, icon: <Globe className="size-4 shrink-0" /> },
    { mode: "theme", label: m.mode.theme, icon: <Palette className="size-4 shrink-0" /> },
  ];
  return (
    <div className="@container shrink-0 border-b p-2">
      <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-muted p-0.5" role="tablist" aria-label={m.mode.label}>
        {segments.map((s) => (
          <button
            key={s.mode}
            type="button"
            role="tab"
            aria-selected={current === s.mode}
            title={s.label}
            data-testid={`mode-${s.mode}`}
            onClick={() => current !== s.mode && navigate(lastLocation(s.mode))}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm ${
              current === s.mode
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.icon}
            <span className="truncate @max-[200px]:sr-only">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
