import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getMethodColor } from "../constants/methods";
import { useI18n } from "../i18n";
import { listQuickFolders, listQuickRequests } from "../lib/quickRequests";
import type { QuickFolder, QuickRequest } from "../types/quick";
import "./GlobalSearchModal.css";

/** 结果条数上限，避免大项目渲染过多行 */
const MAX_RESULTS = 50;

interface GlobalSearchModalProps {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  /** 选中结果：打开对应的快捷请求标签页 */
  onOpen: (request: QuickRequest) => void;
}

/** 目录 id → 「父目录 / 子目录」路径映射 */
function buildFolderPaths(folders: QuickFolder[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const resolve = (id: string): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    if (!folder) return "";
    const parent = folder.parentId ? resolve(folder.parentId) : "";
    const path = parent ? `${parent} / ${folder.name}` : folder.name;
    paths.set(id, path);
    return path;
  };
  for (const folder of folders) resolve(folder.id);
  return paths;
}

/** 全局搜索：⌘K 呼出，按名称 / URL / 方法匹配项目内快捷请求，回车打开 */
function GlobalSearchModal({ visible, projectId, onClose, onOpen }: GlobalSearchModalProps) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [requests, setRequests] = useState<QuickRequest[]>([]);
  const [folderPaths, setFolderPaths] = useState<Map<string, string>>(new Map());
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // combobox 与 listbox 的 ARIA 关联 id
  const listId = useId();

  // 每次打开时重置输入并加载最新数据
  useEffect(() => {
    if (!visible) return;
    setKeyword("");
    setActiveIndex(0);
    Promise.all([listQuickRequests(projectId), listQuickFolders(projectId)])
      .then(([reqs, folders]) => {
        setRequests(reqs);
        setFolderPaths(buildFolderPaths(folders));
      })
      .catch((error) => console.error("加载搜索数据失败", error));
  }, [visible, projectId]);

  // 空关键字时按最近更新排序展示，便于快速回到最近编辑的请求
  const results = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    const matched = trimmed
      ? requests.filter(
          (request) =>
            request.name.toLowerCase().includes(trimmed) ||
            request.url.toLowerCase().includes(trimmed) ||
            request.method.toLowerCase().includes(trimmed),
        )
      : [...requests].sort((a, b) => b.updatedAt - a.updatedAt);
    return matched.slice(0, MAX_RESULTS);
  }, [keyword, requests]);

  // 关键字变化后重置选中项
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyword 作为触发器，删掉会失去重置选中项的行为
  useEffect(() => {
    setActiveIndex(0);
  }, [keyword]);

  const openResult = (request: QuickRequest) => {
    onOpen(request);
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
      const request = results[activeIndex];
      if (request) openResult(request);
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
            placeholder={t("search.placeholder")}
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
              {requests.length === 0 ? t("search.noRequests") : t("search.noMatch")}
            </div>
          ) : (
            results.map((request, index) => (
              // biome-ignore lint/a11y/useFocusableInteractive: combobox 模式下焦点留在输入框，由 aria-activedescendant 标记当前项
              <div
                key={request.id}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                data-index={index}
                className={`global-search-item${index === activeIndex ? " global-search-item-active" : ""}`}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => openResult(request)}
              >
                <span
                  className="global-search-method"
                  style={{ color: getMethodColor(request.method) }}
                >
                  {request.method}
                </span>
                <span className="global-search-name">{request.name}</span>
                {request.url && <span className="global-search-url">{request.url}</span>}
                {request.folderId && folderPaths.get(request.folderId) && (
                  <span className="global-search-path">{folderPaths.get(request.folderId)}</span>
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

export default GlobalSearchModal;
