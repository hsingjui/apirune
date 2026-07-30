import { ChevronRight, Import, Pencil, Plus, Search, Trash2, Zap } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { METHODS } from "../constants/methods";
import { getProjectIcon } from "../constants/projectIcons";
import { useShortcutAction } from "../hooks/useShortcuts";
import { getLanguage, t, useI18n } from "../i18n";
import { countHistorySince } from "../lib/history";
import { listProjectStats, SCRATCH_PROJECT_ID } from "../lib/projects";
import { formatCombo, isMac, loadShortcuts } from "../lib/shortcuts";
import type { Project, ProjectStats } from "../types/project";
import type { QuickRequest } from "../types/quick";
import type { ShortcutAction } from "../types/shortcuts";
import HomeSearchModal from "./HomeSearchModal";
import { ProjectIconBadge } from "./ProjectIcon";
import "./Home.css";

interface HomeProps {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  /** 拖拽排序后回调，ids 为新顺序的项目 id 列表 */
  onReorderProjects: (ids: string[]) => void;
  /** 打开内置快速请求项目 */
  onQuickRequest: () => void;
  /** 打开导入请求弹窗：选择 cURL / OpenAPI 方式与目标项目 */
  onImportRequest: () => void;
  /** 搜索选中快捷请求：打开对应项目并定位到该请求 */
  onOpenRequest: (request: QuickRequest) => void;
}

/** 拖拽项目卡片时的 dataTransfer 类型标识 */
const DRAG_PROJECT_TYPE = "text/apirune-project";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(getLanguage(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** 一周内显示相对时间，更早回退到具体日期 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t("time.justNow");
  if (diff < hour) return t("time.minutesAgo", { n: Math.floor(diff / minute) });
  if (diff < day) return t("time.hoursAgo", { n: Math.floor(diff / hour) });
  if (diff < 7 * day) return t("time.daysAgo", { n: Math.floor(diff / day) });
  return formatDate(timestamp);
}

/** 判断时间戳是否属于今天，用于卡片“最后发送”展示 */
function isToday(timestamp: number): boolean {
  const date = new Date(timestamp);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** 卡片入场交错延迟，项目多时封顶避免末尾卡片等待过久 */
function enterDelay(index: number): string {
  return `${Math.min(index, 10) * 40}ms`;
}

/** 按当前时刻取问候语 key */
function greetingKey(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return "home.greetingMorning";
  if (hour >= 12 && hour < 18) return "home.greetingAfternoon";
  return "home.greetingEvening";
}

/** 问候区日期：月日 + 星期 */
function formatToday(): string {
  return new Date().toLocaleDateString(getLanguage(), {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/** 图例中的方法缩写，与设计稿一致 */
const METHOD_SHORT: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT" };

const EMPTY_STATS: ProjectStats = { methodCounts: {}, environmentNames: [], lastSentAt: null };

/** 卡片上最多展示的环境徽章数，超出折叠为 +N */
const MAX_ENV_BADGES = 2;

/** 搜索框快捷键提示，按平台区分修饰键 */
const SEARCH_KBD = isMac() ? "⌘ K" : "Ctrl K";

/** 主页展示的常用快捷键，按分组与使用频率排列：与设置页分组顺序一致 */
const HOME_SHORTCUTS: ShortcutAction[] = [
  "globalSearch",
  "newProject",
  "newRequest",
  "sendRequest",
  "saveRequest",
  "importCurl",
  "closeTab",
  "nextTab",
  "prevTab",
  "refresh",
  "openSettings",
];

function Home({
  projects,
  onOpenProject,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onReorderProjects,
  onQuickRequest,
  onImportRequest,
  onOpenRequest,
}: HomeProps) {
  useI18n();
  // 卡片统计与今日发送数由主页自行加载；项目增删后重新拉取保持同步
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  const [todaySent, setTodaySent] = useState(0);
  const [searchVisible, setSearchVisible] = useState(false);
  // 拖拽排序中的源卡片与当前悬停的目标卡片
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  // 主页与工作区互斥挂载，快捷键不会重复响应
  useShortcutAction("globalSearch", () => setSearchVisible(true));
  useShortcutAction("newProject", onCreateProject);

  // 内置快速请求项目不在网格与统计中展示
  const visibleProjects = projects.filter((project) => project.id !== SCRATCH_PROJECT_ID);

  // 快捷键展示：读当前配置（含自定义改键），总开关关闭时隐藏整区
  const shortcutConfig = loadShortcuts();
  const shortcutEntries = shortcutConfig.enabled
    ? HOME_SHORTCUTS.flatMap((action) => {
        const combo = shortcutConfig.bindings[action];
        return combo ? [{ action, keys: formatCombo(combo) }] : [];
      })
    : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: projects 作为触发器，项目变化时刷新统计
  useEffect(() => {
    listProjectStats()
      .then(setStats)
      .catch((error) => console.error("加载项目统计失败:", error));
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    countHistorySince(todayStart.getTime())
      .then(setTodaySent)
      .catch((error) => console.error("加载今日发送数失败:", error));
  }, [projects]);

  const totalRequests = Object.values(stats).reduce(
    (sum, item) => sum + Object.values(item.methodCounts).reduce((a, b) => a + b, 0),
    0,
  );

  /** 将拖拽中的卡片插入到目标卡片位置，并提交新顺序 */
  const dropOnProject = (targetId: string) => {
    const sourceId = draggingId;
    setDraggingId(null);
    setDropId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = visibleProjects.map((project) => project.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorderProjects(ids);
  };

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-text">
          <h1 className="home-title">{t(greetingKey())}</h1>
          <p className="home-subtitle">
            <span>{formatToday()}</span>
            <span className="home-subtitle-sep">·</span>
            <span>
              {visibleProjects.length > 0
                ? t("home.heroStats", { projects: visibleProjects.length, requests: totalRequests })
                : t("home.subtitleEmpty")}
            </span>
            {todaySent > 0 && (
              <>
                <span className="home-subtitle-sep">·</span>
                <span>{t("home.heroSent", { sent: todaySent })}</span>
              </>
            )}
          </p>
        </div>
        <div className="home-header-actions">
          <button type="button" className="home-search" onClick={() => setSearchVisible(true)}>
            <Search />
            <span className="home-search-text">{t("home.searchPlaceholder")}</span>
            <kbd>{SEARCH_KBD}</kbd>
          </button>
          <Button onClick={onCreateProject}>
            <Plus />
            {t("home.newProject")}
          </Button>
        </div>
      </header>

      {/* 快捷入口卡片：不依赖项目上下文的高频动作 */}
      <div className="home-quick">
        <button type="button" className="home-quick-card" onClick={onQuickRequest}>
          <span className="home-quick-icon">
            <Zap />
          </span>
          <span className="home-quick-text">
            <span className="home-quick-title">{t("home.quickRequest")}</span>
            <span className="home-quick-desc">{t("home.quickRequestDesc")}</span>
          </span>
          <ChevronRight className="home-quick-arrow" />
        </button>
        <button
          type="button"
          className="home-quick-card home-quick-card-import"
          onClick={onImportRequest}
        >
          <span className="home-quick-icon">
            <Import />
          </span>
          <span className="home-quick-text">
            <span className="home-quick-title">{t("home.importRequest")}</span>
            <span className="home-quick-desc">{t("home.importRequestDesc")}</span>
          </span>
          <ChevronRight className="home-quick-arrow" />
        </button>
      </div>

      <div className="home-cols">
        <section className="home-main">
          <div className="home-section-head">
            <h2 className="home-section-title">{t("home.myProjects")}</h2>
            <span className="home-section-count">{visibleProjects.length}</span>
          </div>
          <div className="home-grid">
            {visibleProjects.map((project, index) => {
              const projectStats = stats[project.id] ?? EMPTY_STATS;
              // 按固定方法顺序取有数据的分段，未知方法不进分布条但计入总数
              const segments = METHODS.map((method) => ({
                ...method,
                count: projectStats.methodCounts[method.value] ?? 0,
              })).filter((segment) => segment.count > 0);
              const total = Object.values(projectStats.methodCounts).reduce((a, b) => a + b, 0);
              const envNames = projectStats.environmentNames;
              return (
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  className={`project-card${draggingId === project.id ? " project-card-dragging" : ""}${
                    dropId === project.id ? " project-card-drop" : ""
                  }`}
                  style={
                    {
                      animationDelay: enterDelay(index),
                      "--card-accent": getProjectIcon(project.icon).color,
                    } as CSSProperties
                  }
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_PROJECT_TYPE, project.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingId(project.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropId(null);
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(DRAG_PROJECT_TYPE)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropId(project.id);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDropId((prev) => (prev === project.id ? null : prev));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropOnProject(project.id);
                  }}
                  onClick={() => onOpenProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenProject(project.id);
                    }
                  }}
                >
                  <div className="project-card-actions">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="project-card-action"
                          aria-label={`${t("home.rename")} ${project.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onEditProject(project);
                          }}
                        >
                          <Pencil />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("home.rename")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="project-card-action project-card-action-danger"
                          aria-label={`${t("common.delete")} ${project.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteProject(project);
                          }}
                        >
                          <Trash2 />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("common.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="project-card-head">
                    <ProjectIconBadge icon={project.icon} size={20} badgeSize={42} />
                    <div className="project-card-heading">
                      <span className="project-card-name">{project.name}</span>
                      <span className="project-card-time">
                        {projectStats.lastSentAt && isToday(projectStats.lastSentAt)
                          ? t("home.lastSentAt", {
                              time: formatRelativeTime(projectStats.lastSentAt),
                            })
                          : t("home.notSentToday")}
                      </span>
                    </div>
                  </div>
                  {total > 0 ? (
                    <div className="project-card-stats">
                      <div className="project-card-mbar" aria-hidden="true">
                        {segments.map((segment) => (
                          <span
                            key={segment.value}
                            style={{ flexGrow: segment.count, backgroundColor: segment.color }}
                          />
                        ))}
                      </div>
                      <div className="project-card-legend">
                        {segments.map((segment) => (
                          <span key={segment.value} className="project-card-legend-item">
                            <i style={{ backgroundColor: segment.color }} />
                            {METHOD_SHORT[segment.value] ?? segment.value}
                            <b>{segment.count}</b>
                          </span>
                        ))}
                        <span className="project-card-legend-total">
                          {t("home.totalRequests", { n: total })}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="project-card-nodata">
                      <i />
                      <span>{t("home.noRequests")}</span>
                      <i />
                    </div>
                  )}
                  {envNames.length > 0 && (
                    <div className="project-card-foot">
                      {envNames.slice(0, MAX_ENV_BADGES).map((name, envIndex) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 环境名可能重复，索引仅用于去重
                        <span key={`${name}-${envIndex}`} className="project-card-env">
                          {name}
                        </span>
                      ))}
                      {envNames.length > MAX_ENV_BADGES && (
                        <span className="project-card-env">
                          +{envNames.length - MAX_ENV_BADGES}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              className="project-card project-card-create"
              style={{ animationDelay: enterDelay(visibleProjects.length) }}
              onClick={onCreateProject}
            >
              <span className="project-card-create-icon">
                <Plus />
              </span>
              <span className="project-card-create-text">{t("home.newProject")}</span>
            </button>
          </div>
        </section>

        {shortcutEntries.length > 0 && (
          <aside className="home-rail">
            <div className="home-section-head">
              <h2 className="home-section-title">{t("settings.shortcuts")}</h2>
            </div>
            <div className="home-shortcuts-card">
              {shortcutEntries.map(({ action, keys }) => (
                <div key={action} className="home-shortcut">
                  <span className="home-shortcut-name">{t(`shortcuts.${action}`)}</span>
                  <span className="home-shortcut-keys">
                    {keys.map((key, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 快捷键组合为静态展示，顺序不变
                      <kbd key={`${key}-${index}`}>{key}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      <HomeSearchModal
        visible={searchVisible}
        projects={projects}
        onClose={() => setSearchVisible(false)}
        onOpenProject={onOpenProject}
        onOpenRequest={onOpenRequest}
      />
    </div>
  );
}

export default Home;
