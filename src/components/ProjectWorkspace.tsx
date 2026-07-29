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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMethodColor } from "../constants/methods";
import { usePersistentState } from "../hooks/usePersistentState";
import {
  useCloseTabInterceptor,
  useShortcutAction,
  useTabCycleInterceptor,
} from "../hooks/useShortcuts";
import { getLanguage, useI18n } from "../i18n";
import { listEnvironments, loadActiveEnvId, saveActiveEnvId } from "../lib/environments";
import type { Environment } from "../types/environment";
import type { HistoryEntry } from "../types/history";
import type { Project } from "../types/project";
import type { QuickRequest } from "../types/quick";
import type { ParsedCurl } from "../utils/curl";
import { closeHoverMenu, positionHoverMenu } from "../utils/hoverMenu";
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
  requestTabState?: RequestTabState;
  onRequestTabStateChange?: (projectId: string, state: RequestTabState) => void;
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
  /** 标签上展示的请求方法徽标；新建空白快捷请求缺省 */
  method?: string;
  /** 对应已保存请求的 id，用于避免重复打开 */
  requestId?: string;
  /** 已保存请求所在目录，null 为根级；保存弹窗回填用 */
  folderId?: string | null;
  /** 标签标题；缺省时按序号显示「快捷请求 N」 */
  name?: string;
}

/** 项目内请求标签页的会话状态；切换项目后用于恢复打开的标签与当前选中项 */
export interface RequestTabState {
  tabs: RequestTab[];
  activeId: string | null;
}

/** 请求标签的名称：超出标签宽度被截断时，用统一样式的 Tooltip 悬浮展示完整名称 */
function RequestTabLabel({ name }: { name: string }) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 名称变更但元素宽度不变时 ResizeObserver 不会触发，需要依赖 name 重新检测
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    // scrollWidth > clientWidth 表示出现省略号截断；标签增删、窗口缩放会改变溢出状态，用 ResizeObserver 实时更新
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [name]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={nameRef} className="workspace-request-tab-name">
          {name}
        </span>
      </TooltipTrigger>
      {truncated && <TooltipContent className="max-w-80 break-all">{name}</TooltipContent>}
    </Tooltip>
  );
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
    color: "var(--pi-amber)",
    Icon: Zap,
  },
  {
    key: "ws",
    labelKey: "workspace.newWs",
    descKey: "workspace.newWsDesc",
    color: "var(--pi-teal)",
    Icon: Cable,
  },
  {
    key: "import",
    labelKey: "workspace.importData",
    descKey: "workspace.importDataDesc",
    color: "var(--pi-green)",
    Icon: Import,
  },
];

/** 环境徽标配色：按环境顺序循环取色；用 --pi-* OKLCH 令牌，深浅主题自动调整明度 */
const ENV_BADGE_COLORS = [
  "var(--pi-violet)",
  "var(--pi-teal)",
  "var(--pi-pink)",
  "var(--pi-blue)",
  "var(--pi-orange)",
  "var(--pi-green)",
];

/** 令牌色的柔和底色：color-mix 对 var() 与十六进制均适用（十六进制无法用于 var() 时追加透明度） */
const softColorBg = (value: string) => `color-mix(in srgb, ${value} 10%, transparent)`;

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
  requestTabState,
  onRequestTabStateChange,
  initialRequest,
  onInitialRequestConsumed,
  initialCurl,
  onInitialCurlConsumed,
}: ProjectWorkspaceProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<SectionKey>("apis");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 侧栏宽度全局持久化，重开应用后恢复上次拖拽的宽度
  const [sidebarWidth, setSidebarWidth] = usePersistentState("apirune:sidebar-width", 264);
  // 各标签的未保存标记：编辑器内容相对保存基准变化时上报
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});
  // 待确认的关闭操作：关闭含未保存内容的标签前先弹确认框
  const [pendingClose, setPendingClose] = useState<
    { kind: "one"; id: string } | { kind: "all" } | { kind: "others" } | null
  >(null);
  const [keyword, setKeyword] = useState("");
  // 快捷请求标签页：点击加号 / 快捷请求卡片创建，全部关闭后回到快捷入口
  const [requestTabs, setRequestTabs] = useState<RequestTab[]>(() => requestTabState?.tabs ?? []);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(
    () => requestTabState?.activeId ?? null,
  );
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
  // 触发按钮上的彩色圆点：与下拉菜单中的徽标取同一色板，便于一眼识别当前环境
  const activeEnvIndex = environments.findIndex((env) => env.id === activeEnvId);
  const activeEnvColor =
    activeEnvIndex >= 0 ? ENV_BADGE_COLORS[activeEnvIndex % ENV_BADGE_COLORS.length] : null;

  useEffect(() => {
    onRequestTabStateChange?.(project.id, { tabs: requestTabs, activeId: activeRequestId });
  }, [activeRequestId, onRequestTabStateChange, project.id, requestTabs]);

  // 标签过多溢出时，激活标签变化 / 新开标签后自动滚动到可见区域；已在可视区内则不动
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 标签增删（requestTabs 变化）时也要重新检查激活标签的可见性，函数体内不直接引用属刻意为之
  useEffect(() => {
    const container = tabsScrollRef.current;
    if (!container || activeRequestId === null) return;
    container
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeRequestId, requestTabs]);

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
    const tab: RequestTab = { id: createId(), seq, initial, method: initial?.method };
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
      method: request.method,
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

  /** 实际执行关闭单个标签（不做未保存检查） */
  const doCloseRequestTab = (id: string) => {
    const index = requestTabs.findIndex((tab) => tab.id === id);
    const nextTabs = requestTabs.filter((tab) => tab.id !== id);
    setRequestTabs(nextTabs);
    setDirtyTabs((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // 关闭当前标签时，优先切到左侧标签，其次右侧，最后回到快捷入口
    if (activeRequestId === id) {
      setActiveRequestId(nextTabs[index - 1]?.id ?? nextTabs[index]?.id ?? null);
    }
  };

  /** 关闭单个标签：含未保存内容的先弹确认框 */
  const closeRequestTab = (id: string) => {
    if (dirtyTabs[id]) {
      setPendingClose({ kind: "one", id });
      return;
    }
    doCloseRequestTab(id);
  };

  // 快捷键：请求管理页有快捷请求标签打开时，⌘W 关闭当前标签而非项目
  useCloseTabInterceptor(() => {
    if (section !== "apis" || activeRequestId === null) return false;
    closeRequestTab(activeRequestId);
    return true;
  });

  /** 实际执行关闭全部（不做未保存检查） */
  const doCloseAllTabs = () => {
    setRequestTabs([]);
    setActiveRequestId(null);
    setDirtyTabs({});
  };

  /** 关闭全部标签页，回到快捷入口；有未保存内容时先确认 */
  const closeAllTabs = () => {
    if (requestTabs.some((tab) => dirtyTabs[tab.id])) {
      setPendingClose({ kind: "all" });
      return;
    }
    doCloseAllTabs();
  };

  /** 关闭除当前激活标签外的其它标签页 */
  const doCloseOtherTabs = () => {
    if (activeRequestId === null) return;
    setRequestTabs((tabs) => tabs.filter((tab) => tab.id === activeRequestId));
    setDirtyTabs((prev) =>
      activeRequestId in prev ? { [activeRequestId]: prev[activeRequestId] } : {},
    );
  };

  const closeOtherTabs = () => {
    if (activeRequestId === null) return;
    if (requestTabs.some((tab) => tab.id !== activeRequestId && dirtyTabs[tab.id])) {
      setPendingClose({ kind: "others" });
      return;
    }
    doCloseOtherTabs();
  };

  /** 确认框中的关闭操作：按类型执行 */
  const confirmPendingClose = () => {
    if (!pendingClose) return;
    if (pendingClose.kind === "one") doCloseRequestTab(pendingClose.id);
    else if (pendingClose.kind === "all") doCloseAllTabs();
    else doCloseOtherTabs();
    setPendingClose(null);
  };

  // 待定关闭涉及的未保存数量 / 单个标签名，用于确认框文案
  const pendingCloseDirtyCount =
    pendingClose?.kind === "all"
      ? requestTabs.filter((tab) => dirtyTabs[tab.id]).length
      : pendingClose?.kind === "others"
        ? requestTabs.filter((tab) => tab.id !== activeRequestId && dirtyTabs[tab.id]).length
        : 1;
  const pendingCloseTabName =
    pendingClose?.kind === "one"
      ? (requestTabs.find((tab) => tab.id === pendingClose.id)?.name ?? t("workspace.quickRequest"))
      : "";

  // 快捷键：工作区打开多个请求标签时，nextTab/prevTab 优先在请求标签间循环
  useTabCycleInterceptor((step) => {
    if (section !== "apis" || activeRequestId === null || requestTabs.length < 2) return false;
    const index = requestTabs.findIndex((tab) => tab.id === activeRequestId);
    if (index < 0) return false;
    const next = requestTabs[(index + step + requestTabs.length) % requestTabs.length];
    setActiveRequestId(next.id);
    return true;
  });

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
          ? {
              ...tab,
              requestId: request.id,
              name: request.name,
              folderId: request.folderId,
              method: request.method,
            }
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
              <div
                className="workspace-more"
                onMouseEnter={positionHoverMenu}
                onFocus={positionHoverMenu}
              >
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
                  <div
                    ref={tabsScrollRef}
                    className="workspace-tabs-scroll"
                    // 标签过多时横向滚动：纵向滚轮映射为横向，避免挤压右侧环境组件
                    onWheel={(event) => {
                      event.currentTarget.scrollLeft += event.deltaY;
                    }}
                  >
                    {requestTabs.map((tab) => {
                      const tabName =
                        tab.name ??
                        (tab.kind === "ws"
                          ? `WebSocket${tab.seq > 1 ? ` ${tab.seq}` : ""}`
                          : `${t("workspace.quickRequest")}${tab.seq > 1 ? ` ${tab.seq}` : ""}`);
                      return (
                        <div
                          key={tab.id}
                          role="tab"
                          aria-selected={activeRequestId === tab.id}
                          tabIndex={0}
                          className={`workspace-request-tab${activeRequestId === tab.id ? " workspace-request-tab-active" : ""}`}
                          onClick={() => setActiveRequestId(tab.id)}
                          // 标签位于横向滚动容器内，中键按下会触发浏览器 autoscroll 并吞掉 auxclick；
                          // 在中键 mousedown 阶段阻止默认行为，保证下面的 onAuxClick 能收到点击
                          onMouseDown={(event) => {
                            if (event.button === 1) event.preventDefault();
                          }}
                          onAuxClick={(event) => {
                            if (event.button !== 1) return;
                            event.preventDefault();
                            closeRequestTab(tab.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setActiveRequestId(tab.id);
                            }
                          }}
                        >
                          {tab.kind === "ws" ? (
                            <Cable className="workspace-request-tab-icon" />
                          ) : tab.method ? (
                            <span
                              className="workspace-request-tab-method"
                              style={{ color: getMethodColor(tab.method) }}
                            >
                              {tab.method}
                            </span>
                          ) : (
                            <Zap className="workspace-request-tab-icon" />
                          )}
                          <RequestTabLabel name={tabName} />
                          {dirtyTabs[tab.id] && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="workspace-request-tab-dirty" aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipContent>{t("workspace.unsavedChanges")}</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="workspace-request-tab-close"
                                aria-label={t("workspace.closeQuickRequest")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  closeRequestTab(tab.id);
                                }}
                              >
                                <X />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t("common.close")}</TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                    {/* 尾部操作区：不溢出时跟在最后一个标签后面；溢出时吸附固定在可视区右端 */}
                    <div className="workspace-tab-actions">
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
                      <div
                        className="workspace-more"
                        onMouseEnter={positionHoverMenu}
                        onFocus={positionHoverMenu}
                      >
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
                            onClick={() =>
                              activeRequestId !== null && closeRequestTab(activeRequestId)
                            }
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
                      {activeEnvColor && (
                        <span
                          className="workspace-env-dot"
                          style={{ backgroundColor: activeEnvColor }}
                          aria-hidden="true"
                        />
                      )}
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
                                style={{ color, backgroundColor: softColorBg(color) }}
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
                      onDirtyChange={(dirty) =>
                        setDirtyTabs((prev) =>
                          prev[tab.id] === dirty ? prev : { ...prev, [tab.id]: dirty },
                        )
                      }
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
                          style={{ color, backgroundColor: softColorBg(color) }}
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
        projectId={project.id}
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

      {/* 未保存关闭确认：关闭标签 / 全部 / 其它时若有未保存内容先确认 */}
      <Dialog open={pendingClose !== null} onOpenChange={(open) => !open && setPendingClose(null)}>
        <DialogContent
          className="sm:max-w-[420px]"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{t("workspace.unsavedCloseTitle")}</DialogTitle>
          </DialogHeader>
          <p className="workspace-unsaved-close-hint">
            {pendingClose?.kind === "one"
              ? t("workspace.unsavedCloseOne", { name: pendingCloseTabName })
              : t("workspace.unsavedCloseMany", { count: pendingCloseDirtyCount })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingClose(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmPendingClose}>
              {t("workspace.closeAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProjectWorkspace;
