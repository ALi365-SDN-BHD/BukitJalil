import "./zod-config.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setNonce } from "get-nonce";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { EventsProvider } from "./lib/events.tsx";
import "./index.css";

// Light / dark follows the system (plan 10.1). Done here because the CSP forbids inline scripts.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

// The server puts a per-response nonce on <meta property="csp-nonce"> and allows <style> elements carrying
// it (plan 11). Radix reads it through get-nonce for the scroll-lock styles of dialogs and selects.
const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce;
if (nonce) setNonce(nonce);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <EventsProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </EventsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
