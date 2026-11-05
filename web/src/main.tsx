import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { AuthGate } from "./auth/AuthGate";
import { Root } from "./Root";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

createRoot(root).render(
  <StrictMode>
    <AuthGate>
      <Root />
    </AuthGate>
  </StrictMode>,
);
