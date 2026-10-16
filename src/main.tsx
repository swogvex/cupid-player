import React from "react";
import ReactDOM from "react-dom/client";
import Gallery from "./views/Gallery";
import "./styles/tokens.css";
import "./styles/base.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>,
);
