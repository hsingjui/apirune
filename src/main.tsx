import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "@arco-design/web-react";
// Arco 命令式组件（Notification/Message）在 React 19 下需要此适配器注册 createRoot，
// 否则内部回退到已移除的 ReactDOM.render 而报错。需在任何 Arco 命令式调用前执行。
import "@arco-design/web-react/es/_util/react-19-adapter.js";
import "@arco-design/web-react/dist/css/arco.css";
import "./styles/global.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
