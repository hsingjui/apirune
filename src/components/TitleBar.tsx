import { getCurrentWindow } from "@tauri-apps/api/window";
import { House, RefreshCw, Settings, X } from "lucide-react";
import { useState } from "react";
import { useShortcutAction } from "../hooks/useShortcuts";
import { useI18n } from "../i18n";
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
  const { t } = useI18n();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    if (refreshing) return;
    onRefresh?.();
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 600);
  };

  useShortcutAction("refresh", handleRefresh);
  useShortcutAction("openSettings", () => setSettingsVisible(true));

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
            title={t("common.close")}
            aria-label={t("common.close")}
            onClick={closeWindow}
          />
          <button
            type="button"
            className="traffic-light traffic-light-minimize"
            title={t("titlebar.minimize")}
            aria-label={t("titlebar.minimize")}
            onClick={minimizeWindow}
          />
          <button
            type="button"
            className="traffic-light traffic-light-maximize"
            title={t("titlebar.maximize")}
            aria-label={t("titlebar.maximize")}
            onClick={toggleMaximizeWindow}
          />
        </div>

        <div className="titlebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeId === null}
            className={`titlebar-tab${activeId === null ? " titlebar-tab-active" : ""}`}
            onClick={() => onSelectTab(null)}
          >
            <House />
            <span className="titlebar-tab-name">{t("titlebar.home")}</span>
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
                title={t("titlebar.closeProject")}
                aria-label={t("titlebar.closeNamed", { name: tab.name })}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="titlebar-actions">
        <button
          type="button"
          className={`titlebar-btn${refreshing ? " titlebar-btn-refreshing" : ""}`}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={handleRefresh}
        >
          <RefreshCw />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title={t("common.settings")}
          aria-label={t("common.settings")}
          onClick={() => setSettingsVisible(true)}
        >
          <Settings />
        </button>
      </div>

      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </header>
  );
}

export default TitleBar;
