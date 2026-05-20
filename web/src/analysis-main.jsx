// web/src/analysis-main.jsx — entry point for the Deep Analysis page.
//
// Optional editorial fonts: see main.jsx for the import pattern.
//
// import "@fontsource/geist/400.css";
// import "@fontsource/geist/500.css";
// import "@fontsource/geist/600.css";
// import "@fontsource/jetbrains-mono/400.css";
// import "@fontsource/jetbrains-mono/500.css";
// import "@fontsource/newsreader/400-italic.css";
// import "@fontsource/newsreader/500-italic.css";

import React from "react";
import { createRoot } from "react-dom/client";
import AnalysisApp from "./AnalysisApp.jsx";
import "./styles.css";

const root = document.getElementById("app");
createRoot(root).render(
  <React.StrictMode>
    <AnalysisApp />
  </React.StrictMode>,
);
