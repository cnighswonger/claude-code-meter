// web/src/main.jsx — entry point
//
// Optional: self-hosted editorial fonts (Geist + JetBrains Mono + Newsreader).
// Default is system stack. To enable, `npm install @fontsource/geist
// @fontsource/jetbrains-mono @fontsource/newsreader` and uncomment the imports
// below. The corresponding font-family overrides live in styles.css.
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
import App from "./App.jsx";
import "./styles.css";

const root = document.getElementById("app");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
