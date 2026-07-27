import {
  Cable,
  ChevronDown,
  History,
  Import,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCloseTabInterceptor, useShortcutAction } from "../hooks/useShortcuts";
import { getLanguage, useI18n } from "../i18n";
import { listEnvironments, loadActiveEnvId, saveActiveEnvId } from "../lib/environments";
import type { Environment } from "../types/environment";
import type { HistoryEntry } from "../types/history";
import type { Project } from "../types/project";
import type { QuickRequest } from "../types/quick";
import type { ParsedCurl } from "../utils/curl";
import { closeHoverMenu } from "../utils/hoverMenu";
import { createId } from "../utils/id";
import ApiTree, { type ApiTreeHandle } from "./ApiTree";
import CurlImportModal from "./CurlImportModal";
import EnvironmentModal from "./EnvironmentModal";
import GlobalSearchModal from "./GlobalSearchModal";
import HistoryPanel from "./HistoryPanel";
import OpenApiImportModal from "./OpenApiImportModal";
import { ProjectIconBadge } from "./ProjectIcon";
import RequestEditor from "./RequestEditor";
import WsEditor from "./WsEditor";
import "./ProjectWorkspace.css";

interface ProjectWorkspaceProps {
  project: Project;
  /** 主页搜索深链打开的快捷请求，打开后通过回调清除 */
  initialRequest?: QuickRequest | null;
  onInitialRequestConsumed?: () => void;
  /** 主页导入 cURL 后带入的初始配置，打开后通过回调清除；空对象为新建空快捷请求 */
  initialCurl?: ParsedCurl | null;
  onInitialCurlConsumed?: () => void;
}

type SectionKey = "apis" | "history" | "settings";

/** 请求标签页；initial 为初始配置（curl 导入 / 已保存请求）；seq 为快捷请求创建时固定的序号，关闭其它标签不会改名 */
interface RequestTab {
  id: string;
  seq: number;
  /** 标签类型；缺省为快捷请求，ws 为 WebSocket 连接 */
  kind?: "ws";
  initial?: ParsedCurl;
  /** 对应已保存请求的 id，用于避免重复打开 */
  requestId?: string;
  /** 已保存请求所在目录，null 为根级；保存弹窗回填用 */
  folderId?: string | null;
  /** 标签标题；缺省时按序号显示「快捷请求 N」 */
  name?: string;
}

/** 左侧导航栏条目；labelKey 为文案 key，渲染时翻译 */
const NAV_ITEMS: { key: SectionKey; labelKey: string; Icon: typeof LayoutGrid }[] = [
  { key: "apis", labelKey: "workspace.requests", Icon: LayoutGrid },
  { key: "history", labelKey: "workspace.history", Icon: History },
  { key: "settings", labelKey: "workspace.projectSettings", Icon: Settings },
];

/** 请求管理主区的快捷入口卡片 */
const QUICK_ACTIONS: {
  key: string;
  labelKey: string;
  descKey: string;
  color: string;
  Icon: typeof LayoutGrid;
}[] = [
  {
    key: "quick",
    labelKey: "workspace.quickRequest",
    descKey: "workspace.quickRequestDesc",
    color: "#f7ba1e",
    Icon: Zap,
  },
  {
    key: "ws",
    labelKey: "workspace.newWs",
    descKey: "workspace.newWsDesc",
    color: "#0fc6c2",
    Icon: Cable,
  },
  {
    key: "import",
    labelKey: "workspace.importData",
    descKey: "workspace.importDataDesc",
    color: "#00b42a",
    Icon: Import,
  },
];

/** 环境徽标配色：按环境顺序循环取色 */
const ENV_BADGE_COLORS = ["#722ed1", "#0fc6c2", "#f5319d", "#165dff", "#ff7d00", "#00b42a"];

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(getLanguage(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 项目工作区：左侧功能导航 + 请求列表侧栏 + 主内容区 */
function ProjectWorkspace({
  project,
  initialRequest,
  onInitialRequestConsumed,
  initialCurl,
  onInitialCurlConsumed,
}: ProjectWorkspaceProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<SectionKey>("apis");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [keyword, setKeyword] = useState("");
  // 快捷请求标签页：点击加号 / 快捷请求卡片创建，全部关闭后回到快捷入口
  const [requestTabs, setRequestTabs] = useState<RequestTab[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [curlModalVisible, setCurlModalVisible] = useState(false);
  const [openapiModalVisible, setOpenapiModalVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [envModalVisible, setEnvModalVisible] = useState(false);
  // 环境列表：下拉框选择环境，右侧按钮打开环境管理
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [envMenuOpen, setEnvMenuOpen] = useState(false);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const treeRef = useRef<ApiTreeHandle>(null);
  // 主页导入 cURL 去重：StrictMode 下 effect 重复执行时按引用判重，避免开出两个标签
  const initialCurlRef = useRef<ParsedCurl | null>(null);
  const activeEnv = environments.find((env) => env.id === activeEnvId) ?? null;

  /** 选中环境并持久化到数据库，下次打开项目时恢复 */
  const selectEnvironment = (envId: string | null) => {
    setActiveEnvId(envId);
    saveActiveEnvId(project.id, envId).catch((error) => console.error("保存环境选择失败", error));
  };

  /** 环境保存后刷新列表；若选中的环境已被删除则清除选择 */
  const handleEnvSaved = (envs: Environment[]) => {
    setEnvironments(envs);
    if (activeEnvId !== null && !envs.some((env) => env.id === activeEnvId)) {
      selectEnvironment(null);
    }
  };

  /** 响应提取变量写入环境后重新加载，让编辑器拿到最新的环境变量 */
  const reloadEnvironments = () => {
    listEnvironments(project.id)
      .then(setEnvironments)
      .catch((error) => console.error("加载环境列表失败", error));
  };

  useEffect(() => {
    listEnvironments(project.id)
      .then(setEnvironments)
      .catch((error) => console.error("加载环境列表失败", error));
    loadActiveEnvId(project.id)
      .then(setActiveEnvId)
      .catch((error) => console.error("加载环境选择失败", error));
  }, [project.id]);

  const showSidebar = section === "apis" && !sidebarCollapsed;

  /** 拖拽侧栏右缘调整宽度，限制在 200–480px */
  const startSidebarResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e: PointerEvent) => {
      setSidebarWidth(Math.min(480, Math.max(200, startWidth + e.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-sidebar-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("is-sidebar-resizing");
  };

  const addRequestTab = (initial?: ParsedCurl) => {
    // 序号取现有最大序号 + 1，保证新标签不与存活标签重名
    const seq =
      requestTabs
        .filter((tab) => tab.kind !== "ws")
        .reduce((max, tab) => Math.max(max, tab.seq), 0) + 1;
    const tab: RequestTab = { id: createId(), seq, initial };
    setRequestTabs((tabs) => [...tabs, tab]);
    setActiveRequestId(tab.id);
  };

  /** 新建 WebSocket 连接标签页，序号在 ws 标签内独立递增 */
  const addWsTab = () => {
    const seq =
      requestTabs
        .filter((tab) => tab.kind === "ws")
        .reduce((max, tab) => Math.max(max, tab.seq), 0) + 1;
    const tab: RequestTab = { id: createId(), seq, kind: "ws" };
    setRequestTabs((tabs) => [...tabs, tab]);
    setActiveRequestId(tab.id);
  };

  /** 打开已保存的快捷请求：已有标签时直接聚焦，否则新建标签 */
  const openRequestTab = (request: QuickRequest) => {
    const existing = requestTabs.find((tab) => tab.requestId === request.id);
    if (existing) {
      setActiveRequestId(existing.id);
      return;
    }
    // 标签 id 由请求 id 派生：同一请求即使被连续触发两次（如 StrictMode 重复执行副作用），
    // 也只会生成同一个标签，配合更新函数内的去重避免重复打开
    const tab: RequestTab = {
      id: `request-${request.id}`,
      seq: 0,
      requestId: request.id,
      folderId: request.folderId,
      name: request.name,
      initial: {
        method: request.method,
        url: request.url,
        params: request.params,
        headers: request.headers,
        bodyType: request.bodyType,
        body: request.body,
      },
    };
    setRequestTabs((tabs) =>
      tabs.some((item) => item.requestId === request.id) ? tabs : [...tabs, tab],
    );
    setActiveRequestId(tab.id);
  };

  // 主页搜索选中请求：挂载后直接打开对应标签
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在深链请求变化时打开一次
  useEffect(() => {
    if (!initialRequest || initialRequest.projectId !== project.id) return;
    setSection("apis");
    openRequestTab(initialRequest);
    onInitialRequestConsumed?.();
  }, [initialRequest]);

  // 主页导入 cURL：挂载后创建带初始配置的快捷请求标签页
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在 initialCurl 变化时打开一次
  useEffect(() => {
    if (!initialCurl) {
      initialCurlRef.current = null;
      return;
    }
    if (initialCurlRef.current === initialCurl) return;
    initialCurlRef.current = initialCurl;
    setSection("apis");
    addRequestTab(initialCurl);
    onInitialCurlConsumed?.();
  }, [initialCurl]);

  // 快捷键：请求管理页新建快捷请求
  useShortcutAction(
    "newRequest",
    () => {
      addRequestTab();
    },
    section === "apis",
  );

  // 快捷键：打开 cURL 导入弹窗
  useShortcutAction(
    "importCurl",
    () => {
      setCurlModalVisible(true);
    },
    section === "apis",
  );

  // 快捷键：打开全局搜索
  useShortcutAction("globalSearch", () => setSearchVisible(true));

  const closeRequestTab = (id: string) => {
    const index = requestTabs.findIndex((tab) => tab.id === id);
    const nextTabs = requestTabs.filter((tab) => tab.id !== id);
    setRequestTabs(nextTabs);
    // 关闭当前标签时，优先切到左侧标签，其次右侧，最后回到快捷入口
    if (activeRequestId === id) {
      setActiveRequestId(nextTabs[index - 1]?.id ?? nextTabs[index]?.id ?? null);
    }
  };

  // 快捷键：请求管理页有快捷请求标签打开时，⌘W 关闭当前标签而非项目
  useCloseTabInterceptor(() => {
    if (section !== "apis" || activeRequestId === null) return false;
    closeRequestTab(activeRequestId);
    return true;
  });

  /** 关闭全部标签页，回到快捷入口 */
  const closeAllTabs = () => {
    setRequestTabs([]);
    setActiveRequestId(null);
  };

  /** 关闭除当前激活标签外的其它标签页 */
  const closeOtherTabs = () => {
    if (activeRequestId === null) return;
    setRequestTabs((tabs) => tabs.filter((tab) => tab.id === activeRequestId));
  };

  const handleQuickAction = (key: string) => {
    if (key === "quick") {
      addRequestTab();
      return;
    }
    if (key === "ws") {
      addWsTab();
      return;
    }
    if (key === "import") {
      setOpenapiModalVisible(true);
    }
  };

  /** 保存成功：同步标签的 requestId / 名称 / 目录，并刷新请求树 */
  const handleRequestSaved = (tabId: string, request: QuickRequest) => {
    setRequestTabs((tabs) =>
      tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, requestId: request.id, name: request.name, folderId: request.folderId }
          : tab,
      ),
    );
    treeRef.current?.reload();
  };

  /** 左侧树重命名成功：同步已打开标签的名称 */
  const handleRequestRenamed = (request: QuickRequest) => {
    setRequestTabs((tabs) =>
      tabs.map((tab) => (tab.requestId === request.id ? { ...tab, name: request.name } : tab)),
    );
  };

  /** curl 解析成功：新建带初始配置的快捷请求标签页 */
  const handleCurlImport = (parsed: ParsedCurl) => {
    setCurlModalVisible(false);
    addRequestTab(parsed);
  };

  /** 将历史记录恢复为快捷请求标签页 */
  const handleHistoryRestore = (entry: HistoryEntry) => {
    setSection("apis");
    addRequestTab({
      method: entry.method,
      url: entry.url,
      params: entry.params,
      headers: entry.headers,
      bodyType: entry.bodyType,
      body: entry.body,
    });
  };

  return (
    <div className="workspace">
      {/* 左侧功能导航栏 */}
      <nav className="workspace-rail" aria-label={t("workspace.navAria")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="workspace-rail-project">
              <ProjectIconBadge icon={project.icon} size={20} badgeSize={40} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{project.name}</TooltipContent>
        </Tooltip>
        {NAV_ITEMS.map(({ key, labelKey, Icon }) => (
          <button
            key={key}
            type="button"
            className={`workspace-rail-item${section === key ? " workspace-rail-item-active" : ""}`}
            onClick={() => setSection(key)}
          >
            <Icon />
            <span className="workspace-rail-label">{t(labelKey)}</span>
          </button>
        ))}
      </nav>

      {/* 右侧功能容器：请求列表侧栏 + 主内容区 */}
      <div className="workspace-panel">
        {showSidebar && (
          <aside className="workspace-sidebar" style={{ width: sidebarWidth }}>
            <div className="workspace-sidebar-header">
              <h3 className="workspace-sidebar-title">{t("workspace.requests")}</h3>
              <div className="workspace-sidebar-header-actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="workspace-sidebar-collapse"
                      aria-label={t("search.title")}
                      onClick={() => setSearchVisible(true)}
                    >
                      <Search />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("search.title")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="workspace-sidebar-collapse"
                      aria-label={t("workspace.collapseSidebar")}
                      onClick={() => setSidebarCollapsed(true)}
                    >
                      <PanelLeftClose />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("workspace.collapseSidebar")}</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="workspace-sidebar-toolbar">
              <Input
                className="workspace-sidebar-search"
                placeholder={t("workspace.searchRequests")}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              <div className="workspace-more">
                <Button size="icon" aria-label={t("workspace.new")} aria-haspopup="menu">
                  <Plus />
                </Button>
                <div
                  className="workspace-more-menu workspace-more-menu-right"
                  role="menu"
                  onClick={closeHoverMenu}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-more-menu-item"
                    onClick={() => addRequestTab()}
                  >
                    {t("workspace.quickRequest")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-more-menu-item"
                    onClick={() => {
                      setKeyword("");
                      treeRef.current?.startCreate("folder");
                    }}
                  >
                    {t("workspace.newFolder")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-more-menu-item"
                    onClick={addWsTab}
                  >
                    {t("workspace.menuWebSocket")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-more-menu-item"
                    onClick={() => setCurlModalVisible(true)}
                  >
                    {t("workspace.importCurl")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="workspace-more-menu-item"
                    onClick={() => setOpenapiModalVisible(true)}
                  >
                    {t("workspace.importOpenapi")}
                  </button>
                </div>
              </div>
            </div>
            <ApiTree
              ref={treeRef}
              projectId={project.id}
              keyword={keyword}
              onOpenRequest={openRequestTab}
              onRenamed={handleRequestRenamed}
            />
            <div
              className="workspace-sidebar-resizer"
              aria-hidden="true"
              onPointerDown={startSidebarResize}
            />
          </aside>
        )}

        <main className="workspace-main">
          {section === "apis" && (
            <>
              <div className="workspace-toolbar">
                <div className="workspace-toolbar-left">
                  {sidebarCollapsed && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="workspace-toolbar-btn"
                          aria-label={t("workspace.expandSidebar")}
                          onClick={() => setSidebarCollapsed(false)}
                        >
                          <PanelLeftOpen />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("workspace.expandSidebar")}</TooltipContent>
                    </Tooltip>
                  )}
                  {requestTabs.map((tab) => (
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
                      {tab.kind === "ws" ? (
                        <Cable className="workspace-request-tab-icon" />
                      ) : (
                        <Zap className="workspace-request-tab-icon" />
                      )}
                      <span className="workspace-request-tab-name">
                        {tab.name ??
                          (tab.kind === "ws"
                            ? `WebSocket${tab.seq > 1 ? ` ${tab.seq}` : ""}`
                            : `${t("workspace.quickRequest")}${tab.seq > 1 ? ` ${tab.seq}` : ""}`)}
                      </span>
                      <button
                        type="button"
                        className="workspace-request-tab-close"
                        title={t("common.close")}
                        aria-label={t("workspace.closeQuickRequest")}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeRequestTab(tab.id);
                        }}
                      >
                        <X />
                      </button>
                    </div>
                  ))}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="workspace-toolbar-btn"
                        aria-label={t("workspace.newQuickRequest")}
                        onClick={() => addRequestTab()}
                      >
                        <Plus />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t("workspace.newQuickRequest")}</TooltipContent>
                  </Tooltip>
                  <div className="workspace-more">
                    <button
                      type="button"
                      className="workspace-toolbar-btn"
                      aria-label={t("workspace.more")}
                      aria-haspopup="menu"
                    >
                      <MoreHorizontal />
                    </button>
                    <div className="workspace-more-menu" role="menu" onClick={closeHoverMenu}>
                      <button
                        type="button"
                        role="menuitem"
                        className="workspace-more-menu-item"
                        disabled={requestTabs.length === 0}
                        onClick={closeAllTabs}
                      >
                        {t("workspace.closeAll")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="workspace-more-menu-item"
                        disabled={activeRequestId === null}
                        onClick={() => activeRequestId !== null && closeRequestTab(activeRequestId)}
                      >
                        {t("workspace.closeCurrent")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="workspace-more-menu-item"
                        disabled={activeRequestId === null || requestTabs.length < 2}
                        onClick={closeOtherTabs}
                      >
                        {t("workspace.closeOthers")}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="workspace-env-group">
                  <div
                    className="workspace-env-select"
                    onBlur={(event) => {
                      // 焦点移出下拉区域时收起菜单
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setEnvMenuOpen(false);
                    }}
                  >
                    <button
                      type="button"
                      className="workspace-env"
                      aria-haspopup="listbox"
                      aria-expanded={envMenuOpen}
                      onClick={() => setEnvMenuOpen((open) => !open)}
                    >
                      <span
                        className={`workspace-env-value${activeEnv ? "" : " workspace-env-placeholder"}`}
                      >
                        {activeEnv?.name ?? t("workspace.selectEnv")}
                      </span>
                      <ChevronDown className="workspace-env-icon" />
                    </button>
                    {envMenuOpen && (
                      <div
                        className="workspace-env-menu"
                        role="listbox"
                        aria-label={t("workspace.selectEnvAria")}
                      >
                        {environments.length === 0 && (
                          <p className="workspace-env-empty">{t("workspace.noEnvs")}</p>
                        )}
                        {environments.map((env, index) => {
                          const color = ENV_BADGE_COLORS[index % ENV_BADGE_COLORS.length];
                          return (
                            <button
                              key={env.id}
                              type="button"
                              role="option"
                              aria-selected={env.id === activeEnvId}
                              className={`workspace-env-item${env.id === activeEnvId ? " workspace-env-item-active" : ""}`}
                              onClick={() => {
                                selectEnvironment(env.id);
                                setEnvMenuOpen(false);
                              }}
                            >
                              <span
                                className="workspace-env-item-badge"
                                style={{ color, backgroundColor: `${color}14` }}
                                aria-hidden="true"
                              >
                                {env.name.trim().charAt(0) || t("env.badgeFallback")}
                              </span>
                              <span className="workspace-env-item-name">{env.name}</span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="workspace-env-manage-entry"
                          onClick={() => {
                            setEnvMenuOpen(false);
                            setEnvModalVisible(true);
                          }}
                        >
                          <Settings />
                          <span>{t("workspace.manageEnv")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="workspace-env-manage"
                        aria-label={t("workspace.manageEnv")}
                        onClick={() => setEnvModalVisible(true)}
                      >
                        <Menu />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t("workspace.manageEnv")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* 每个标签常驻渲染仅切换显隐，保留各自的编辑状态 */}
              {requestTabs.map((tab) => (
                <div
                  key={tab.id}
                  className="workspace-request-editor"
                  hidden={activeRequestId !== tab.id}
                >
                  {tab.kind === "ws" ? (
                    <WsEditor />
                  ) : (
                    <RequestEditor
                      projectId={project.id}
                      environment={activeEnv}
                      active={activeRequestId === tab.id}
                      initial={tab.initial}
                      requestId={tab.requestId}
                      requestName={tab.name}
                      initialFolderId={tab.folderId}
                      onSaved={(request) => handleRequestSaved(tab.id, request)}
                      onEnvChanged={reloadEnvironments}
                    />
                  )}
                </div>
              ))}

              {activeRequestId === null && (
                <div className="workspace-content">
                  <div className="workspace-actions">
                    {QUICK_ACTIONS.map(({ key, labelKey, descKey, color, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className="workspace-action-card"
                        onClick={() => handleQuickAction(key)}
                      >
                        <span
                          className="workspace-action-icon"
                          style={{ color, backgroundColor: `${color}14` }}
                        >
                          <Icon />
                        </span>
                        <span className="workspace-action-label">{t(labelKey)}</span>
                        <span className="workspace-action-desc">{t(descKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {section === "history" && (
            <HistoryPanel projectId={project.id} onRestore={handleHistoryRestore} />
          )}

          {section === "settings" && (
            <div className="workspace-content workspace-settings">
              <h2 className="workspace-settings-title">{t("workspace.projectSettings")}</h2>
              <div className="workspace-settings-card">
                <div className="workspace-settings-profile">
                  <ProjectIconBadge icon={project.icon} size={24} badgeSize={48} />
                  <span className="workspace-settings-name">{project.name}</span>
                </div>
                <dl className="workspace-settings-meta">
                  <div className="workspace-settings-row">
                    <dt>{t("workspace.projectId")}</dt>
                    <dd className="workspace-settings-mono">{project.id}</dd>
                  </div>
                  <div className="workspace-settings-row">
                    <dt>{t("workspace.createdAt")}</dt>
                    <dd>{formatDateTime(project.createdAt)}</dd>
                  </div>
                  <div className="workspace-settings-row">
                    <dt>{t("workspace.updatedAt")}</dt>
                    <dd>{formatDateTime(project.updatedAt)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </main>
      </div>

      <CurlImportModal
        visible={curlModalVisible}
        onCancel={() => setCurlModalVisible(false)}
        onImport={handleCurlImport}
      />

      <OpenApiImportModal
        visible={openapiModalVisible}
        projectId={project.id}
        onCancel={() => setOpenapiModalVisible(false)}
        onImported={() => {
          setOpenapiModalVisible(false);
          treeRef.current?.reload();
        }}
      />

      <EnvironmentModal
        visible={envModalVisible}
        projectId={project.id}
        onClose={() => setEnvModalVisible(false)}
        onSaved={handleEnvSaved}
      />

      <GlobalSearchModal
        visible={searchVisible}
        projectId={project.id}
        onClose={() => setSearchVisible(false)}
        onOpen={(request) => {
          setSection("apis");
          openRequestTab(request);
        }}
      />
    </div>
  );
}

export default ProjectWorkspace;
