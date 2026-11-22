import type { Appearance } from "@bukitjalil/shared";
import { useEffect, useState } from "react";

const KEY = "bj-appearance";
const media = window.matchMedia("(prefers-color-scheme: dark)");
let current: Appearance = read();

/** The last choice, kept in this browser so the first paint already has the right colours. */
function read(): Appearance {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function paint(): void {
  const dark = current === "dark" || (current === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Called once at startup (main.tsx; the CSP forbids inline scripts): paints and follows the system. */
export function startTheme(): void {
  paint();
  media.addEventListener("change", paint);
}

/** Apply the saved setting (plan M5 layer 3) and remember it for the next start. */
export function setAppearance(appearance: Appearance): void {
  current = appearance;
  try {
    window.localStorage.setItem(KEY, appearance);
  } catch {
    // the setting on the server is what counts; this only avoids a flash at start
  }
  paint();
}

/** Is the page in dark mode? Follows the class main.tsx sets from the system setting. */
export function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
