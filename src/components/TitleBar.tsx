import { getCurrentWindow } from "@tauri-apps/api/window";
import { House, Minus, RefreshCw, Settings, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useShortcutAction } from "../hooks/useShortcuts";
import { useI18n } from "../i18n";
import type { Project } from "../types/project";
import ProjectIcon from "./ProjectIcon";
import SettingsModal from "./SettingsModal";
import "./TitleBar.css";

/**
 * 平台差异：macOS 窗口按钮在左上角（交通灯），Windows 在右上角（原生矩形按钮）。
 * Tauri 的 webview UA 在 macOS 含 Macintosh、Windows 含 Windows NT，足够可靠。
 */
const isMac = /macintosh|mac os x/i.test(navigator.userAgent);

interface TitleBarProps {
  /** 已打开的项目标签，按打开顺序排列 */
  tabs: Project[];
  /** 当前激活标签，null 表示主页 */
  activeId: string | null;
  onSelectTab: (id: string | null) => void;
  onCloseTab: (id: string) => void;
  /** 拖拽已打开标签后的新顺序 */
  onReorderTabs: (ids: string[]) => void;
  onRefresh?: () => void;
}

const DRAG_TAB_TYPE = "text/apirune-project-tab";

function TitleBar({ tabs, activeId, onSelectTab, onCloseTab, onReorderTabs, onRefresh }: TitleBarProps) {
  const { t } = useI18n();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  // Windows 下需要在最大化/还原时切换中间按钮的图标
  useEffect(() => {
    if (isMac) return;
    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => {
      void appWindow.isMaximized().then(setMaximized);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

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

  /** 将拖拽标签插入目标标签的位置，并提交新的打开标签顺序 */
  const dropOnTab = (targetId: string) => {
    const sourceId = draggingId;
    setDraggingId(null);
    setDropId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = tabs.map((tab) => tab.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorderTabs(ids);
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left">
        {isMac && (
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
        )}

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
              className={`titlebar-tab${activeId === tab.id ? " titlebar-tab-active" : ""}${
                draggingId === tab.id ? " titlebar-tab-dragging" : ""
              }${dropId === tab.id ? " titlebar-tab-drop" : ""}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TAB_TYPE, tab.id);
                event.dataTransfer.effectAllowed = "move";
                setDraggingId(tab.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropId(null);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TAB_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropId(tab.id);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDropId((prev) => (prev === tab.id ? null : prev));
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropOnTab(tab.id);
              }}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onCloseTab(tab.id);
              }}
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

        {!isMac && (
          <div className="window-controls">
            <button
              type="button"
              className="window-control-btn"
              title={t("titlebar.minimize")}
              aria-label={t("titlebar.minimize")}
              onClick={minimizeWindow}
            >
              <Minus />
            </button>
            <button
              type="button"
              className="window-control-btn"
              title={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
              aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
              onClick={toggleMaximizeWindow}
            >
              {maximized ? (
                /* lucide 无还原图标（Copy 方向相反），按 lucide 24 网格自绘以保持笔画一致 */
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="10" width="12" height="12" rx="2" />
                  <path d="M10 10V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6" />
                </svg>
              ) : (
                <Square />
              )}
            </button>
            <button
              type="button"
              className="window-control-btn window-control-btn-close"
              title={t("common.close")}
              aria-label={t("common.close")}
              onClick={closeWindow}
            >
              <X />
            </button>
          </div>
        )}
      </div>

      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </header>
  );
}

export default TitleBar;
