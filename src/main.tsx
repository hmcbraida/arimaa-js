import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

/**
 * Vite browser entrypoint.
 *
 * The React tree starts at `App`, which composes the game view around the shared
 * Arimaa engine.
 */
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
