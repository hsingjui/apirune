import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupContextMenu } from "./lib/context-menu";
import { loadSettings } from "./lib/settings";
import { applyAppearance } from "./lib/themes";
import "./styles/global.css";
import App from "./App";

// 渲染前先应用主题与字体，避免启动闪烁
applyAppearance(loadSettings());

// 禁用 WebView 原生右键菜单
setupContextMenu();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster position="top-center" />
    </TooltipProvider>
  </React.StrictMode>,
);
