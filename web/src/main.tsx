import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/glass.css"; // capa visual Liquid Glass: va al final

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
