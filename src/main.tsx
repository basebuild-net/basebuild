import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// Suppress the native right-click context menu - the app draws its own menus
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  // Allow context menu inside inputs/textareas (cut/copy/paste)
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
  e.preventDefault();
});
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
