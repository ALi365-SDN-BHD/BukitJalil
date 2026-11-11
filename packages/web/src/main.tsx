import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setNonce } from "get-nonce";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { EventsProvider } from "./lib/events.tsx";
import { startTheme } from "./lib/theme.ts";
import "./index.css";

// Light / dark (plan 10.1, M5 layer 3), before the first render; the saved setting is applied in App.
startTheme();

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
