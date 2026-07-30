import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { ChevronRight, Download, History, Loader2, RotateCw, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMethodColor, METHODS } from "../constants/methods";
import { getLanguage, useI18n } from "../i18n";
import {
  clearHistory,
  deleteHistoryByRange,
  deleteHistoryEntry,
  getHistoryEntry,
  listHistory,
} from "../lib/history";
import { saveResponseBody } from "../lib/http";
import type { HistoryEntry, HistoryEntrySummary } from "../types/history";
import type { KeyValueItem } from "../types/request";
import { JsonViewer } from "./JsonView";
import "./HistoryPanel.css";

interface HistoryPanelProps {
  projectId: string;
  /** 将某条历史恢复为快捷请求 */
  onRestore?: (entry: HistoryEntry) => void;
}

/** 结果状态筛选 */
type StatusFilter = "all" | "ok" | "fail";

const STATUS_FILTERS: { value: StatusFilter; labelKey: string }[] = [
  { value: "all", labelKey: "history.all" },
  { value: "ok", labelKey: "history.ok" },
  { value: "fail", labelKey: "history.failShort" },
];

const DETAIL_TABS = ["body", "headers", "request"] as const;

/** 每页加载条数 */
const PAGE_SIZE = 100;

/** 中缝拖拽时左栏与右侧详情各自的最小宽度 */
const HISTORY_PANE_MIN_WIDTH = 240;

/** 一条历史是否成功（收到响应且状态码 < 400） */
function isOk(entry: HistoryEntrySummary): boolean {
  return entry.error === null && entry.status !== null && entry.status < 400;
}

/** 列表项时间：日期由分组标题展示，这里只显示时刻 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getLanguage(), { hour12: false });
}

/** 按天分组的 key（本地日期） */
function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** 分组标题：今天 / 昨天 / 本地化日期 */
function formatDayLabel(timestamp: number, t: (key: string) => string): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return t("history.today");
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t("history.yesterday");
  return date.toLocaleDateString(getLanguage(), { year: "numeric", month: "long", day: "numeric" });
}

/** 详情时间：完整年月日时分秒 */
function formatFullTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(getLanguage(), { hour12: false });
}

/** JSON 文本尝试格式化；非 JSON 返回 null */
function tryPrettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** 代码块：可解析为 JSON 则高亮展示，否则原样输出；大文本解析开销大，按内容 memo */
function CodeBlock({ text }: { text: string }) {
  const pretty = useMemo(() => tryPrettyJson(text), [text]);
  if (pretty === null) return <pre className="history-code">{text}</pre>;
  return (
    <div className="history-code history-code-json">
      <JsonViewer value={pretty} />
    </div>
  );
}

/** 请求历史面板：左侧可筛选的历史列表 + 右侧详情 */
function HistoryPanel({ projectId, onRestore }: HistoryPanelProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<HistoryEntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  // 分页：满页即视为还有更多；下一页偏移量取已加载条数，删除后仍能对齐
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryEntry | null>(null);
  const [detailTab, setDetailTab] = useState<(typeof DETAIL_TABS)[number]>("body");
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
// 左栏宽度：null 用 CSS 默认 320px；拖过中缝后为像素值
const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
const rootRef = useRef<HTMLDivElement>(null);
const sidebarRef = useRef<HTMLElement>(null);

/** 拖拽中缝分隔线调整左栏宽度，两侧各保留最小宽度 */
const startSidebarResize = (event: React.PointerEvent) => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = sidebarRef.current?.offsetWidth ?? 0;
  const total = rootRef.current?.clientWidth ?? 0;
  const max = Math.max(total - HISTORY_PANE_MIN_WIDTH, HISTORY_PANE_MIN_WIDTH);
  const onMove = (e: PointerEvent) => {
    const next = startWidth + (e.clientX - startX);
    setSidebarWidth(Math.min(max, Math.max(HISTORY_PANE_MIN_WIDTH, next)));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("is-history-resizing");
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  document.body.classList.add("is-history-resizing");
};

  // 二进制响应（Base64 存储）：图片类型生成 data URL 预览
  const detailImageUrl = useMemo(() => {
    if (detail?.responseBodyEncoding !== "base64") return null;
    const contentType = (detail.responseHeaders["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return contentType.startsWith("image/")
      ? `data:${contentType};base64,${detail.responseBody}`
      : null;
  }, [detail]);

  /** 将二进制响应保存到本地文件 */
  const handleSaveDetailBody = async () => {
    if (!detail) return;
    const path = await saveFileDialog();
    if (!path) return;
    try {
      await saveResponseBody(path, detail.responseBody, detail.responseBodyEncoding);
      toast.success(t("editor.saveFileDone"));
    } catch (error) {
      console.error("保存响应到文件失败", error);
      toast.error(t("editor.saveFileFailed"));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: t 仅用于 catch 一次性 toast
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listHistory(projectId, PAGE_SIZE);
      setEntries(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (error) {
      toast.error(t("history.loadFailed", { error: String(error) }));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** 加载下一页并追加到列表末尾 */
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await listHistory(projectId, PAGE_SIZE, entries.length);
      setEntries((list) => [...list, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (error) {
      toast.error(t("history.loadFailed", { error: String(error) }));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 选中项变化时加载完整详情
  // biome-ignore lint/correctness/useExhaustiveDependencies: t 仅用于 catch 一次性 toast
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getHistoryEntry(selectedId)
      .then((entry) => {
        if (!cancelled) setDetail(entry);
      })
      .catch((error) => toast.error(t("history.detailFailed", { error: String(error) })));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (lower && !entry.url.toLowerCase().includes(lower)) return false;
      if (methodFilter !== "ALL" && entry.method !== methodFilter) return false;
      if (statusFilter === "ok" && !isOk(entry)) return false;
      if (statusFilter === "fail" && isOk(entry)) return false;
      return true;
    });
  }, [entries, keyword, methodFilter, statusFilter]);

  // 列表按 createdAt 倒序返回，顺序扫描即可按天聚合
  const groups = useMemo(() => {
    const result: { key: string; timestamp: number; items: HistoryEntrySummary[] }[] = [];
    for (const entry of filtered) {
      const key = dayKey(entry.createdAt);
      const last = result[result.length - 1];
      if (last && last.key === key) last.items.push(entry);
      else result.push({ key, timestamp: entry.createdAt, items: [entry] });
    }
    return result;
  }, [filtered]);

  const toggleDay = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteHistoryEntry(id);
      setEntries((list) => list.filter((entry) => entry.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (error) {
      toast.error(t("history.deleteFailed", { error: String(error) }));
    }
  };

  /** 删除某一天的全部历史（含未分页加载的部分） */
  const handleDeleteDay = (timestamp: number, key: string) => {
    toast(t("history.deleteDayConfirm", { day: formatDayLabel(timestamp, t) }), {
      action: {
        label: t("common.delete"),
        onClick: async () => {
          const date = new Date(timestamp);
          const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
          const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
          try {
            await deleteHistoryByRange(projectId, start, end);
            setEntries((list) => list.filter((entry) => dayKey(entry.createdAt) !== key));
            if (detail && dayKey(detail.createdAt) === key) setSelectedId(null);
          } catch (error) {
            toast.error(t("history.deleteFailed", { error: String(error) }));
          }
        },
      },
    });
  };

  const handleClear = () => {
    if (entries.length === 0) return;
    toast(t("history.clearConfirm", { count: entries.length }), {
      action: {
        label: t("history.clearAction"),
        onClick: async () => {
          try {
            await clearHistory(projectId);
            setEntries([]);
            setSelectedId(null);
            setHasMore(false);
          } catch (error) {
            toast.error(t("history.clearFailed", { error: String(error) }));
          }
        },
      },
    });
  };

  return (
    <div ref={rootRef} className="history-panel">
      {/* 左侧：筛选 + 历史列表 */}
      <aside
        ref={sidebarRef}
        className="history-sidebar"
        style={sidebarWidth !== null ? { width: sidebarWidth } : undefined}
      >
        <div className="history-sidebar-header">
          <h3 className="history-sidebar-title">{t("history.title")}</h3>
          <div className="history-sidebar-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.refresh")}
                  onClick={() => void refresh()}
                >
                  <RotateCw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.refresh")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("history.clear")}
                  onClick={handleClear}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("history.clear")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="history-filters">
          <Input
            className="history-filter-search"
            placeholder={t("history.searchUrl")}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="history-filter-row">
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger
                className="history-filter-method"
                aria-label={t("history.filterMethodAria")}
              >
                {methodFilter === "ALL" ? (
                  <span className="history-filter-method-all">{t("history.allMethods")}</span>
                ) : (
                  <span className="history-method" style={{ color: getMethodColor(methodFilter) }}>
                    {methodFilter}
                  </span>
                )}
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="ALL">{t("history.allMethods")}</SelectItem>
                {METHODS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    <span className="history-method" style={{ color: entry.color }}>
                      {entry.value}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className="history-filter-status"
              role="radiogroup"
              aria-label={t("history.filterStatusAria")}
            >
              {STATUS_FILTERS.map(({ value, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === value}
                  className={`history-filter-chip${statusFilter === value ? " history-filter-chip-active" : ""}`}
                  onClick={() => setStatusFilter(value)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="history-list">
          {loading ? (
            <div className="history-empty">
              <Loader2 className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="history-empty">
              <span className="history-empty-icon">
                <History />
              </span>
              <p className="history-empty-text">
                {entries.length === 0 ? t("history.emptyTitle") : t("history.noMatch")}
              </p>
              <p className="history-empty-hint">
                {entries.length === 0 ? t("history.emptyHint") : t("history.adjustFilter")}
              </p>
            </div>
          ) : (
            groups.map((group) => {
              const collapsed = collapsedDays.has(group.key);
              return (
                <div
                  key={group.key}
                  className={`history-group${collapsed ? "" : " history-group-open"}`}
                >
                  <div className="history-group-header">
                    <button
                      type="button"
                      className="history-group-toggle"
                      aria-expanded={!collapsed}
                      onClick={() => toggleDay(group.key)}
                    >
                      <ChevronRight className="history-group-chevron" />
                      <span>{formatDayLabel(group.timestamp, t)}</span>
                      <span className="history-group-count">{group.items.length}</span>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="history-group-remove"
                          aria-label={t("history.deleteDay")}
                          onClick={() => handleDeleteDay(group.timestamp, group.key)}
                        >
                          <Trash2 />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("history.deleteDay")}</TooltipContent>
                    </Tooltip>
                  </div>
                  {!collapsed &&
                    group.items.map((entry) => (
                      <div
                        key={entry.id}
                        role="button"
                        tabIndex={0}
                        className={`history-item${selectedId === entry.id ? " history-item-active" : ""}`}
                        onClick={() => setSelectedId(entry.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedId(entry.id);
                          }
                        }}
                      >
                        <div className="history-item-main">
                          <span
                            className="history-method"
                            style={{ color: getMethodColor(entry.method) }}
                          >
                            {entry.method}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="history-item-url">{entry.url}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-80 break-all">
                              {entry.url}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="history-item-meta">
                          {entry.error !== null ? (
                            <span className="history-status is-fail">{t("history.failShort")}</span>
                          ) : (
                            <span
                              className={`history-status${isOk(entry) ? " is-ok" : " is-fail"}`}
                            >
                              {entry.status}
                            </span>
                          )}
                          {entry.durationMs !== null && <span>{entry.durationMs} ms</span>}
                          <span className="history-item-time">{formatTime(entry.createdAt)}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="history-item-remove"
                                aria-label={t("history.deleteEntry")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDelete(entry.id);
                                }}
                              >
                                <Trash2 />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t("common.delete")}</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                </div>
              );
            })
          )}
          {!loading && hasMore && (
            <button
              type="button"
              className="history-load-more"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? <Loader2 className="animate-spin" /> : null}
              {loadingMore ? t("history.loading") : t("history.loadMore")}
            </button>
          )}
        </div>
      </aside>

      {/* 中缝拖拽手柄：骑在左栏右边框上 */}
      <div className="history-resizer" aria-hidden="true" onPointerDown={startSidebarResize} />

      {/* 右侧：详情 */}
      <div className="history-detail">
        {detail === null ? (
          <div className="history-detail-placeholder">
            <span className="history-empty-icon">
              <History />
            </span>
            <p className="history-empty-text">{t("history.selectHint")}</p>
          </div>
        ) : (
          <>
            <div className="history-detail-header">
              <div className="history-detail-line">
                <span className="history-method" style={{ color: getMethodColor(detail.method) }}>
                  {detail.method}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="history-detail-url">{detail.url}</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80 break-all">{detail.url}</TooltipContent>
                </Tooltip>
                {onRestore && (
                  <Button variant="outline" onClick={() => onRestore(detail)}>
                    <Zap />
                    {t("history.resend")}
                  </Button>
                )}
              </div>
              <div className="history-detail-meta">
                {detail.error !== null ? (
                  <span className="history-status is-fail">{t("history.requestFailed")}</span>
                ) : (
                  <span className={`history-status${isOk(detail) ? " is-ok" : " is-fail"}`}>
                    {detail.status}
                  </span>
                )}
                {detail.durationMs !== null && <span>{detail.durationMs} ms</span>}
                <span>{formatFullTime(detail.createdAt)}</span>
              </div>
            </div>

            <div className="history-detail-tabs" role="tablist">
              {DETAIL_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === tab}
                  className={`history-detail-tab${detailTab === tab ? " history-detail-tab-active" : ""}`}
                  onClick={() => setDetailTab(tab)}
                >
                  {t(`history.tab.${tab}`)}
                </button>
              ))}
            </div>

            <div className="history-detail-body">
              {detailTab === "body" ? (
                detail.error !== null ? (
                  <pre className="history-code history-code-error">{detail.error}</pre>
                ) : detail.responseBodyEncoding === "base64" ? (
                  <div className="history-binary-body">
                    {detailImageUrl ? (
                      <img className="history-binary-image" src={detailImageUrl} alt="" />
                    ) : (
                      <p className="history-binary-hint">{t("history.binaryBody")}</p>
                    )}
                    <Button variant="outline" size="sm" onClick={handleSaveDetailBody}>
                      <Download aria-hidden="true" />
                      {t("editor.saveToFile")}
                    </Button>
                  </div>
                ) : detail.responseBody ? (
                  <CodeBlock text={detail.responseBody} />
                ) : (
                  <div className="history-detail-empty">{t("history.emptyBody")}</div>
                )
              ) : detailTab === "headers" ? (
                <HeaderTable
                  rows={Object.entries(detail.responseHeaders)}
                  emptyText={t("history.noRespHeaders")}
                />
              ) : (
                <div className="history-request-info">
                  <HeaderTable
                    title={t("editor.queryParams")}
                    rows={detail.params.map((item: KeyValueItem) => [item.key, item.value])}
                    emptyText={t("history.noQuery")}
                  />
                  <HeaderTable
                    title={t("editor.headersTitle")}
                    rows={detail.headers.map((item: KeyValueItem) => [item.key, item.value])}
                    emptyText={t("history.noReqHeaders")}
                  />
                  <section>
                    <h4 className="history-section-title">
                      {t("history.reqBody")}
                      {detail.bodyType !== "none" && (
                        <span className="history-body-type">{detail.bodyType}</span>
                      )}
                    </h4>
                    {detail.bodyType === "none" || !detail.body ? (
                      <div className="history-detail-empty">{t("history.noBody")}</div>
                    ) : (
                      <CodeBlock text={detail.body} />
                    )}
                  </section>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 键值对只读表格，响应头 / 请求参数共用 */
function HeaderTable({
  title,
  rows,
  emptyText,
}: {
  title?: string;
  rows: [string, string][];
  emptyText: string;
}) {
  return (
    <section>
      {title && <h4 className="history-section-title">{title}</h4>}
      {rows.length === 0 ? (
        <div className="history-detail-empty">{emptyText}</div>
      ) : (
        <div className="history-kv-table">
          {rows.map(([key, value], index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 键名可能重复（如同名 header），索引仅用于去重
            <div key={`${key}-${index}`} className="history-kv-row">
              <span className="history-kv-key">{key}</span>
              <span className="history-kv-value">{value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default HistoryPanel;
