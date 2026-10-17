import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import { applyTheme, initialTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/pixel.css";
import "./styles/layout.css";

// Apply the last theme before the first paint so there is no flash of the default one.
applyTheme(initialTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);