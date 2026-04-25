import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./App.css";

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm("Hay una nueva versión disponible. ¿Deseas recargar para actualizar?")) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log("Aplicación lista para trabajar sin conexión");
  },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
