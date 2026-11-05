import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { App } from "./App";
import { AuthGate } from "./auth/AuthGate";
import { ArtifactPreview } from "./artifacts/ArtifactPreview";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

// "?artifact=…" opens the artifact pane on its own, until the project layout hosts it.
const showArtifact = new URLSearchParams(window.location.search).has("artifact");

createRoot(root).render(
  <StrictMode>
    <AuthGate>{showArtifact ? <ArtifactPreview /> : <App />}</AuthGate>
  </StrictMode>,
);
