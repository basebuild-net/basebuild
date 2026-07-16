import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { initUiScale } from "./lib/uiScale";

// Promote the pre-paint CSS-zoom bootstrap to native webview zoom (which
// does not persist across restarts) before the shell renders.
initUiScale();

// Suppress the native right-click context menu - the app draws its own menus
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  // Allow context menu where native copy/cut/paste matters.
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
  e.preventDefault();
});
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
