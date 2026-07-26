import { useState } from "react";
import { IconClose, IconHome, IconRefresh, IconSettings } from "@arco-design/web-react/icon";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEscClose } from "../hooks/useEscClose";
import type { Project } from "../types/project";
import ProjectIcon from "./ProjectIcon";
import SettingsModal from "./SettingsModal";
import "./TitleBar.css";

interface TitleBarProps {
  /** 已打开的项目标签，按打开顺序排列 */
  tabs: Project[];
  /** 当前激活标签，null 表示主页 */
  activeId: string | null;
  onSelectTab: (id: string | null) => void;
  onCloseTab: (id: string) => void;
  onRefresh?: () => void;
}

function TitleBar({ tabs, activeId, onSelectTab, onCloseTab, onRefresh }: TitleBarProps) {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEscClose(settingsVisible, () => setSettingsVisible(false));

  const handleRefresh = () => {
    if (refreshing) return;
    onRefresh?.();
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 600);
  };

  const closeWindow = () => {
    void getCurrentWindow().close();
  };

  const minimizeWindow = () => {
    void getCurrentWindow().minimize();
  };

  const toggleMaximizeWindow = () => {
    void getCurrentWindow().toggleMaximize();
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left">
        <div className="traffic-lights">
          <button
            type="button"
            className="traffic-light traffic-light-close"
            title="关闭"
            aria-label="关闭"
            onClick={closeWindow}
          />
          <button
            type="button"
            className="traffic-light traffic-light-minimize"
            title="最小化"
            aria-label="最小化"
            onClick={minimizeWindow}
          />
          <button
            type="button"
            className="traffic-light traffic-light-maximize"
            title="最大化"
            aria-label="最大化"
            onClick={toggleMaximizeWindow}
          />
        </div>

        <nav className="titlebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeId === null}
            className={`titlebar-tab${activeId === null ? " titlebar-tab-active" : ""}`}
            onClick={() => onSelectTab(null)}
          >
            <IconHome />
            <span className="titlebar-tab-name">主页</span>
          </button>

          {tabs.length > 0 && <span className="titlebar-divider" aria-hidden="true" />}

          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={activeId === tab.id}
              tabIndex={0}
              className={`titlebar-tab${activeId === tab.id ? " titlebar-tab-active" : ""}`}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
            >
              <ProjectIcon icon={tab.icon} size={14} />
              <span className="titlebar-tab-name">{tab.name}</span>
              <button
                type="button"
                className="titlebar-tab-close"
                title="关闭项目"
                aria-label={`关闭 ${tab.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <IconClose />
              </button>
            </div>
          ))}
        </nav>
      </div>

      <div className="titlebar-actions">
        <button
          type="button"
          className={`titlebar-btn${refreshing ? " titlebar-btn-refreshing" : ""}`}
          title="刷新"
          aria-label="刷新"
          onClick={handleRefresh}
        >
          <IconRefresh />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title="设置"
          aria-label="设置"
          onClick={() => setSettingsVisible(true)}
        >
          <IconSettings />
        </button>
      </div>

      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </header>
  );
}

export default TitleBar;
