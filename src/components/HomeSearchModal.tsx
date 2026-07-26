import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getMethodColor } from "../constants/methods";
import { useI18n } from "../i18n";
import { SCRATCH_PROJECT_ID } from "../lib/projects";
import { listAllQuickRequests } from "../lib/quickRequests";
import type { Project } from "../types/project";
import type { QuickRequest } from "../types/quick";
import { ProjectIconBadge } from "./ProjectIcon";
import "./GlobalSearchModal.css";

/** 结果条数上限，避免渲染过多行 */
const MAX_RESULTS = 50;

type SearchResult =
  | { kind: "project"; project: Project }
  | { kind: "request"; request: QuickRequest };

interface HomeSearchModalProps {
  visible: boolean;
  /** 全部项目（含内置快速请求项目，用于解析请求归属名） */
  projects: Project[];
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onOpenRequest: (request: QuickRequest) => void;
}

/** 主页全局搜索：⌘K 呼出，跨项目匹配项目名与快捷请求（名称 / URL / 方法） */
function HomeSearchModal({
  visible,
  projects,
  onClose,
  onOpenProject,
  onOpenRequest,
}: HomeSearchModalProps) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [requests, setRequests] = useState<QuickRequest[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // combobox 与 listbox 的 ARIA 关联 id
  const listId = useId();

  // 每次打开时重置输入并加载最新数据
  useEffect(() => {
    if (!visible) return;
    setKeyword("");
    setActiveIndex(0);
    listAllQuickRequests()
      .then(setRequests)
      .catch((error) => console.error("加载搜索数据失败", error));
  }, [visible]);

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  // 空关键字时展示全部项目 + 最近更新的请求；内置项目不作为项目结果，其下请求仍可搜索
  const results = useMemo<SearchResult[]>(() => {
    const trimmed = keyword.trim().toLowerCase();
    const candidates = projects.filter((project) => project.id !== SCRATCH_PROJECT_ID);
    const matchedProjects = trimmed
      ? candidates.filter((project) => project.name.toLowerCase().includes(trimmed))
      : [...candidates].sort((a, b) => b.updatedAt - a.updatedAt);
    const matchedRequests = trimmed
      ? requests.filter(
          (request) =>
            request.name.toLowerCase().includes(trimmed) ||
            request.url.toLowerCase().includes(trimmed) ||
            request.method.toLowerCase().includes(trimmed),
        )
      : requests;
    return [
      ...matchedProjects.map((project): SearchResult => ({ kind: "project", project })),
      ...matchedRequests.map((request): SearchResult => ({ kind: "request", request })),
    ].slice(0, MAX_RESULTS);
  }, [keyword, projects, requests]);

  // 关键字变化后重置选中项
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyword 作为触发器，删掉会失去重置行为
  useEffect(() => {
    setActiveIndex(0);
  }, [keyword]);

  const openResult = (result: SearchResult) => {
    if (result.kind === "project") {
      onOpenProject(result.project.id);
    } else {
      onOpenRequest(result.request);
    }
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + delta + results.length) % results.length;
      setActiveIndex(next);
      listRef.current
        ?.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) openResult(result);
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="global-search-dialog top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[560px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("search.title")}</DialogTitle>
        <div className="global-search-input-row">
          <Search className="global-search-icon" aria-hidden="true" />
          <input
            className="global-search-input"
            placeholder={t("home.searchPlaceholder")}
            value={keyword}
            autoFocus
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? `${listId}-opt-${activeIndex}` : undefined}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="global-search-list" ref={listRef} id={listId} role="listbox">
          {results.length === 0 ? (
            <div className="global-search-empty">
              {keyword.trim() ? t("search.noMatch") : t("search.noRequests")}
            </div>
          ) : (
            results.map((result, index) => (
              // biome-ignore lint/a11y/useFocusableInteractive: combobox 模式下焦点留在输入框，由 aria-activedescendant 标记当前项
              <div
                key={
                  result.kind === "project" ? `p-${result.project.id}` : `r-${result.request.id}`
                }
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                data-index={index}
                className={`global-search-item${index === activeIndex ? " global-search-item-active" : ""}`}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => openResult(result)}
              >
                {result.kind === "project" ? (
                  <>
                    <ProjectIconBadge icon={result.project.icon} size={13} badgeSize={24} />
                    <span className="global-search-name">{result.project.name}</span>
                    <span className="global-search-tag">{t("home.searchProjectTag")}</span>
                  </>
                ) : (
                  <>
                    <span
                      className="global-search-method"
                      style={{ color: getMethodColor(result.request.method) }}
                    >
                      {result.request.method}
                    </span>
                    <span className="global-search-name">{result.request.name}</span>
                    {result.request.url && (
                      <span className="global-search-url">{result.request.url}</span>
                    )}
                    <span className="global-search-path">
                      {projectNames.get(result.request.projectId) ?? ""}
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </div>
        <div className="global-search-footer">{t("search.hint")}</div>
      </DialogContent>
    </Dialog>
  );
}

export default HomeSearchModal;
