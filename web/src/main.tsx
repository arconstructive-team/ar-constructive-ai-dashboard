import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { AuthGate } from "./auth/AuthGate";
import { ArtifactPreview } from "./artifacts/ArtifactPreview";
import { Root } from "./Root";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

// "?artifact=…" still opens the artifact pane on its own (the demo and direct links).
const showArtifact = new URLSearchParams(window.location.search).has("artifact");

createRoot(root).render(
  <StrictMode>
    <AuthGate>{showArtifact ? <ArtifactPreview /> : <Root />}</AuthGate>
  </StrictMode>,
);
