import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupContextMenu } from "./lib/context-menu";
import { loadSettings } from "./lib/settings";
import { applyAppearance } from "./lib/themes";
import "./styles/global.css";
import App from "./App";

// 在首帧渲染前标记平台，macOS 透明窗口需要由页面层裁切圆角。
document.documentElement.dataset.platform = navigator.userAgent.includes("Macintosh")
  ? "macos"
  : "desktop";

// 渲染前先应用主题与字体，避免启动闪烁
applyAppearance(loadSettings());

// 禁用 WebView 原生右键菜单
setupContextMenu();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* delayDuration：停顿足够久才弹出，避免鼠标扫过按钮时误触发；
        skipDelayDuration：连续在多个提示目标间移动时保持较快响应 */}
    <TooltipProvider delayDuration={700} skipDelayDuration={300}>
      <App />
      <Toaster position="top-center" />
    </TooltipProvider>
  </React.StrictMode>,
);
