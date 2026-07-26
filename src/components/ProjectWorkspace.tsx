import { useState } from "react";
import { Button, Input, Message, Tooltip } from "@arco-design/web-react";
import {
  IconApps,
  IconClose,
  IconDown,
  IconFilter,
  IconHistory,
  IconImport,
  IconMenuFold,
  IconMenuUnfold,
  IconMore,
  IconPlus,
  IconSettings,
  IconSwap,
  IconThunderbolt,
} from "@arco-design/web-react/icon";
import type { Project } from "../types/project";
import { createId } from "../utils/id";
import { ProjectIconBadge } from "./ProjectIcon";
import RequestEditor from "./RequestEditor";
import "./ProjectWorkspace.css";

interface ProjectWorkspaceProps {
  project: Project;
}

type SectionKey = "apis" | "history" | "settings";

/** 左侧导航栏条目 */
const NAV_ITEMS: { key: SectionKey; label: string; Icon: typeof IconApps }[] = [
  { key: "apis", label: "接口管理", Icon: IconApps },
  { key: "history", label: "请求历史", Icon: IconHistory },
  { key: "settings", label: "项目设置", Icon: IconSettings },
];

/** 接口管理主区的快捷入口卡片 */
const QUICK_ACTIONS: { key: string; label: string; desc: string; color: string; Icon: typeof IconApps }[] = [
  { key: "http", label: "新建 HTTP 接口", desc: "定义并调试一个 HTTP 接口", color: "#cc7c5e", Icon: IconSwap },
  { key: "quick", label: "快捷请求", desc: "无需保存，快速发起请求", color: "#f7ba1e", Icon: IconThunderbolt },
  { key: "import", label: "导入数据", desc: "从 OpenAPI / cURL 导入", color: "#00b42a", Icon: IconImport },
];

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 项目工作区：左侧功能导航 + 接口列表侧栏 + 主内容区，接口调试能力后续接入 */
function ProjectWorkspace({ project }: ProjectWorkspaceProps) {
  const [section, setSection] = useState<SectionKey>("apis");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [keyword, setKeyword] = useState("");
  // 快捷请求标签页：点击加号 / 快捷请求卡片创建，全部关闭后回到快捷入口
  const [requestTabs, setRequestTabs] = useState<{ id: string }[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const showSidebar = section === "apis" && !sidebarCollapsed;

  const addRequestTab = () => {
    const tab = { id: createId() };
    setRequestTabs((tabs) => [...tabs, tab]);
    setActiveRequestId(tab.id);
  };

  const closeRequestTab = (id: string) => {
    const index = requestTabs.findIndex((tab) => tab.id === id);
    const nextTabs = requestTabs.filter((tab) => tab.id !== id);
    setRequestTabs(nextTabs);
    // 关闭当前标签时，优先切到左侧标签，其次右侧，最后回到快捷入口
    if (activeRequestId === id) {
      setActiveRequestId(nextTabs[index - 1]?.id ?? nextTabs[index]?.id ?? null);
    }
  };

  const handleQuickAction = (key: string) => {
    if (key === "quick") {
      addRequestTab();
      return;
    }
    Message.info("功能建设中");
  };

  return (
    <div className="workspace">
      {/* 左侧功能导航栏 */}
      <nav className="workspace-rail" aria-label="项目功能导航">
        <Tooltip content={project.name} position="right">
          <span className="workspace-rail-project">
            <ProjectIconBadge icon={project.icon} size={20} badgeSize={40} />
          </span>
        </Tooltip>
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`workspace-rail-item${section === key ? " workspace-rail-item-active" : ""}`}
            onClick={() => setSection(key)}
          >
            <Icon />
            <span className="workspace-rail-label">{label}</span>
          </button>
        ))}
      </nav>

      {/* 右侧功能容器：接口列表侧栏 + 主内容区 */}
      <div className="workspace-panel">
        {showSidebar && (
          <aside className="workspace-sidebar">
            <div className="workspace-sidebar-header">
              <h3 className="workspace-sidebar-title">接口管理</h3>
            </div>
            <div className="workspace-sidebar-toolbar">
              <Input
                className="workspace-sidebar-search"
                placeholder="搜索接口"
                value={keyword}
                onChange={setKeyword}
                allowClear
              />
              <Tooltip content="筛选">
                <Button icon={<IconFilter />} aria-label="筛选" />
              </Tooltip>
              <Tooltip content="新建">
                <Button type="primary" icon={<IconPlus />} aria-label="新建" />
              </Tooltip>
            </div>
            <div className="workspace-sidebar-tree">
              <div className="workspace-sidebar-empty">
                <span className="workspace-sidebar-empty-icon">
                  <IconApps />
                </span>
                <p className="workspace-sidebar-empty-text">还没有接口</p>
                <p className="workspace-sidebar-empty-hint">点击右上角 + 新建接口</p>
              </div>
            </div>
            </aside>
        )}

        <main className="workspace-main">
          {section === "apis" && (
            <>
              <div className="workspace-toolbar">
                <div className="workspace-toolbar-left">
                  {requestTabs.map((tab, index) => (
                    <div
                      key={tab.id}
                      role="tab"
                      aria-selected={activeRequestId === tab.id}
                      tabIndex={0}
                      className={`workspace-request-tab${activeRequestId === tab.id ? " workspace-request-tab-active" : ""}`}
                      onClick={() => setActiveRequestId(tab.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveRequestId(tab.id);
                        }
                      }}
                    >
                      <IconThunderbolt className="workspace-request-tab-icon" />
                      <span className="workspace-request-tab-name">快捷请求{index > 0 ? ` ${index + 1}` : ""}</span>
                      <button
                        type="button"
                        className="workspace-request-tab-close"
                        title="关闭"
                        aria-label="关闭快捷请求"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeRequestTab(tab.id);
                        }}
                      >
                        <IconClose />
                      </button>
                    </div>
                  ))}
                  <Tooltip content="新建快捷请求">
                    <button type="button" className="workspace-toolbar-btn" aria-label="新建快捷请求" onClick={addRequestTab}>
                      <IconPlus />
                    </button>
                  </Tooltip>
                  <Tooltip content="更多">
                    <button type="button" className="workspace-toolbar-btn" aria-label="更多">
                      <IconMore />
                    </button>
                  </Tooltip>
                </div>
                <button type="button" className="workspace-env">
                  <span className="workspace-env-dot" aria-hidden="true" />
                  <span>默认环境</span>
                  <IconDown />
                </button>
              </div>

              {/* 每个标签常驻渲染仅切换显隐，保留各自的编辑状态 */}
              {requestTabs.map((tab) => (
                <div key={tab.id} className="workspace-request-editor" hidden={activeRequestId !== tab.id}>
                  <RequestEditor />
                </div>
              ))}

              {activeRequestId === null && (
                <div className="workspace-content">
                  <div className="workspace-actions">
                    {QUICK_ACTIONS.map(({ key, label, desc, color, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className="workspace-action-card"
                        onClick={() => handleQuickAction(key)}
                      >
                        <span className="workspace-action-icon" style={{ color, backgroundColor: `${color}14` }}>
                          <Icon />
                        </span>
                        <span className="workspace-action-label">{label}</span>
                        <span className="workspace-action-desc">{desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {section === "history" && (
            <div className="workspace-content workspace-placeholder">
              <span className="workspace-placeholder-icon">
                <IconHistory />
              </span>
              <h2 className="workspace-placeholder-title">请求历史</h2>
              <p className="workspace-placeholder-desc">发起请求后，历史记录会出现在这里</p>
            </div>
          )}

          {section === "settings" && (
            <div className="workspace-content workspace-settings">
              <h2 className="workspace-settings-title">项目设置</h2>
              <div className="workspace-settings-card">
                <div className="workspace-settings-profile">
                  <ProjectIconBadge icon={project.icon} size={24} badgeSize={48} />
                  <span className="workspace-settings-name">{project.name}</span>
                </div>
                <dl className="workspace-settings-meta">
                  <div className="workspace-settings-row">
                    <dt>项目 ID</dt>
                    <dd className="workspace-settings-mono">{project.id}</dd>
                  </div>
                  <div className="workspace-settings-row">
                    <dt>创建时间</dt>
                    <dd>{formatDateTime(project.createdAt)}</dd>
                  </div>
                  <div className="workspace-settings-row">
                    <dt>最近编辑</dt>
                    <dd>{formatDateTime(project.updatedAt)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {/* 底部状态栏 */}
          <footer className="workspace-statusbar">
            <div className="workspace-statusbar-left">
              {section === "apis" && (
                <Tooltip content={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
                  <button
                    type="button"
                    className="workspace-statusbar-btn"
                    aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                    onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                  >
                    {sidebarCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
                  </button>
                </Tooltip>
              )}
            </div>
            <div className="workspace-statusbar-right">
              <span className="workspace-statusbar-status">
                <span className="workspace-statusbar-dot" aria-hidden="true" />
                就绪
              </span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default ProjectWorkspace;
