import {
  FilePlus2,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import type { ReactNode } from "react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMethodColor } from "../constants/methods";
import { useI18n } from "../i18n";
import {
  createQuickFolder,
  createQuickRequest,
  deleteQuickFolder,
  deleteQuickRequest,
  listQuickFolders,
  listQuickRequests,
  updateQuickRequest,
} from "../lib/quickRequests";
import type { QuickFolder, QuickRequest } from "../types/quick";
import { closeHoverMenu } from "../utils/hoverMenu";

/** 拖拽快捷请求时的 dataTransfer 类型标识 */
const DRAG_REQUEST_TYPE = "text/apirune-quick-request";

type CreateType = "request" | "folder";

/** 通过 ref 暴露的操作：在快捷请求根级发起新建请求 / 目录 */
export interface ApiTreeHandle {
  startCreate: (type: CreateType) => void;
  /** 重新加载目录与请求列表（外部保存后刷新） */
  reload: () => void;
}

interface ApiTreeProps {
  projectId: string;
  /** 搜索关键字：非空时平铺展示名称或 URL 匹配的快捷请求 */
  keyword: string;
  /** 点击快捷请求时回调，由工作区打开对应标签页 */
  onOpenRequest: (request: QuickRequest) => void;
  /** 双击重命名成功时回调，由工作区同步已打开标签的名称 */
  onRenamed?: (request: QuickRequest) => void;
}

/**
 * 请求管理侧栏树：目录可嵌套、目录下挂请求，根级与目录内均可新建，
 * 请求可拖拽移动到目录或根级。
 */
const ApiTree = forwardRef<ApiTreeHandle, ApiTreeProps>(function ApiTree(
  { projectId, keyword, onOpenRequest, onRenamed },
  ref,
) {
  const { t } = useI18n();
  const [folders, setFolders] = useState<QuickFolder[]>([]);
  const [requests, setRequests] = useState<QuickRequest[]>([]);
  // 记录被收起的目录 id，默认全部展开
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 行内新建状态：type 为新建类型，parentId 为 null 表示请求树根级
  const [creating, setCreating] = useState<{
    type: CreateType;
    parentId: string | null;
  } | null>(null);
  const [draftName, setDraftName] = useState("");
  // 行内重命名状态：双击请求行触发
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // 当前拖拽悬停的放置目标：目录 id，或 "quick-root" 表示请求树根级
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const reload = () => {
    Promise.all([listQuickFolders(projectId), listQuickRequests(projectId)])
      .then(([folderList, requestList]) => {
        setFolders(folderList);
        setRequests(requestList);
      })
      .catch((error) => console.error("加载快捷请求列表失败", error));
  };

  useEffect(reload, [projectId]);

  const beginCreate = (type: CreateType, parentId: string | null) => {
    setCreating({ type, parentId });
    setDraftName("");
    // 在目录内新建时确保该目录展开
    if (parentId !== null) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  };

  useImperativeHandle(ref, () => ({
    startCreate: (type) => beginCreate(type, null),
    reload,
  }));

  /** 提交行内新建；名称为空则视为取消。先清空状态避免 blur 重复提交 */
  const submitCreate = async () => {
    if (!creating) return;
    const target = creating;
    const name = draftName.trim();
    setCreating(null);
    if (!name) return;
    try {
      if (target.type === "folder") {
        await createQuickFolder({ projectId, parentId: target.parentId, name });
      } else {
        const created = await createQuickRequest({
          projectId,
          folderId: target.parentId,
          name,
        });
        onOpenRequest(created);
      }
      reload();
    } catch (error) {
      console.error("新建失败", error);
      toast.error(t("apiTree.createFailed"));
    }
  };

  /** 提交重命名；名称为空或未变化则视为取消。先清空状态避免 blur 重复提交 */
  const submitRename = async () => {
    if (!renaming) return;
    const target = renaming;
    setRenaming(null);
    const name = target.name.trim();
    const request = requests.find((item) => item.id === target.id);
    if (!request || !name || name === request.name) return;
    try {
      const updated = await updateQuickRequest(target.id, { name });
      reload();
      onRenamed?.(updated);
    } catch (error) {
      console.error("重命名快捷请求失败", error);
      toast.error(t("apiTree.renameFailed"));
    }
  };

  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** 拖拽落下：将快捷请求移到目标目录（null 为根级） */
  const moveRequest = async (requestId: string, folderId: string | null) => {
    const request = requests.find((item) => item.id === requestId);
    if (!request || request.folderId === folderId) return;
    try {
      await updateQuickRequest(requestId, { folderId });
      // 展开目标目录，让移入的请求可见
      if (folderId !== null) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      }
      reload();
    } catch (error) {
      console.error("移动快捷请求失败", error);
      toast.error(t("apiTree.moveFailed"));
    }
  };

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, QuickFolder[]>();
    for (const folder of folders) {
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    return map;
  }, [folders]);

  const requestsByFolder = useMemo(() => {
    const map = new Map<string | null, QuickRequest[]>();
    for (const request of requests) {
      const list = map.get(request.folderId) ?? [];
      list.push(request);
      map.set(request.folderId, list);
    }
    return map;
  }, [requests]);

  /** 目录 / 请求树根级共用的放置目标事件；folderId 为 null 表示根级 */
  const dropHandlers = (targetKey: string, folderId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_REQUEST_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(targetKey);
    },
    onDragLeave: (event: React.DragEvent) => {
      // 移入行内子元素时不清除高亮
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget((prev) => (prev === targetKey ? null : prev));
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const requestId = event.dataTransfer.getData(DRAG_REQUEST_TYPE);
      if (requestId) void moveRequest(requestId, folderId);
    },
  });

  /** 复制快捷请求：在同目录下创建同内容副本 */
  const duplicateRequest = async (request: QuickRequest) => {
    try {
      await createQuickRequest({
        projectId,
        folderId: request.folderId,
        name: t("apiTree.copyName", { name: request.name }),
        method: request.method,
        url: request.url,
        params: request.params,
        headers: request.headers,
        bodyType: request.bodyType,
        body: request.body,
      });
      reload();
    } catch (error) {
      console.error("复制快捷请求失败", error);
      toast.error(t("apiTree.duplicateFailed"));
    }
  };

  /** 删除快捷请求 */
  const removeRequest = async (request: QuickRequest) => {
    try {
      await deleteQuickRequest(request.id);
      reload();
    } catch (error) {
      console.error("删除快捷请求失败", error);
      toast.error(t("apiTree.deleteFailed"));
    }
  };

  /** 删除目录及其子目录和其中的快捷请求 */
  const removeFolder = async (folder: QuickFolder) => {
    try {
      await deleteQuickFolder(folder.id);
      reload();
    } catch (error) {
      console.error("删除快捷请求目录失败", error);
      toast.error(t("apiTree.deleteFailed"));
    }
  };

  const confirmRemoveFolder = (folder: QuickFolder) => {
    toast(t("apiTree.deleteFolderConfirm", { name: folder.name }), {
      action: {
        label: t("common.delete"),
        onClick: () => void removeFolder(folder),
      },
    });
  };

  const renderRequest = (request: QuickRequest, depth: number) => {
    // 重命名态：请求行替换为行内输入框
    if (renaming?.id === request.id) {
      return (
        <div
          key={request.id}
          className="workspace-tree-create"
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <span className="workspace-tree-method" style={{ color: getMethodColor(request.method) }}>
            {request.method}
          </span>
          <Input
            autoFocus
            className="workspace-tree-create-input"
            value={renaming.name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRenaming({ id: request.id, name: event.target.value })}
            onBlur={() => void submitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitRename();
              }
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        </div>
      );
    }
    return (
      <div
        key={request.id}
        role="button"
        tabIndex={0}
        className="workspace-tree-row"
        style={{ paddingLeft: 8 + depth * 16 }}
        title={request.name}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_REQUEST_TYPE, request.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        // 请求行不接受放置：阻断冒泡并清除高亮
        onDragOver={(event) => {
          event.stopPropagation();
          setDropTarget(null);
        }}
        onClick={() => onOpenRequest(request)}
        onDoubleClick={() => setRenaming({ id: request.id, name: request.name })}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenRequest(request);
          }
        }}
      >
        <span className="workspace-tree-method" style={{ color: getMethodColor(request.method) }}>
          {request.method}
        </span>
        <span className="workspace-tree-name">{request.name}</span>
        <div
          className="workspace-more workspace-tree-add"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="workspace-tree-add-btn"
            aria-label={t("apiTree.moreActions", { name: request.name })}
            aria-haspopup="menu"
          >
            <MoreHorizontal />
          </button>
          <div
            className="workspace-more-menu workspace-more-menu-right"
            role="menu"
            onClick={closeHoverMenu}
          >
            <button
              type="button"
              role="menuitem"
              className="workspace-more-menu-item"
              onClick={() => void duplicateRequest(request)}
            >
              {t("apiTree.duplicate")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="workspace-more-menu-item"
              onClick={() => void removeRequest(request)}
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderCreateRow = (depth: number) =>
    creating && (
      <div className="workspace-tree-create" style={{ paddingLeft: 8 + depth * 16 }}>
        {creating.type === "folder" ? (
          <FolderIcon className="workspace-tree-folder-icon" />
        ) : (
          <span className="workspace-tree-method" style={{ color: getMethodColor("GET") }}>
            GET
          </span>
        )}
        <Input
          autoFocus
          className="workspace-tree-create-input"
          placeholder={
            creating.type === "folder" ? t("apiTree.folderName") : t("apiTree.requestName")
          }
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={() => void submitCreate()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitCreate();
            }
            if (event.key === "Escape") setCreating(null);
          }}
        />
      </div>
    );

  /** 行尾悬停出现的新建入口：菜单复用 workspace-more 悬停展开样式 */
  const renderAddMenu = (
    parentId: string | null,
    label: string,
    folderLabel: string,
    onDelete?: () => void,
  ) => (
    <div className="workspace-more workspace-tree-add" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="workspace-tree-add-btn"
        aria-label={label}
        aria-haspopup="menu"
      >
        <Plus />
      </button>
      <div
        className="workspace-more-menu workspace-more-menu-right"
        role="menu"
        onClick={closeHoverMenu}
      >
        <button
          type="button"
          role="menuitem"
          className="workspace-more-menu-item"
          onClick={() => beginCreate("request", parentId)}
        >
          {t("apiTree.newRequest")}
        </button>
        <button
          type="button"
          role="menuitem"
          className="workspace-more-menu-item"
          onClick={() => beginCreate("folder", parentId)}
        >
          {folderLabel}
        </button>
        {onDelete && (
          <button
            type="button"
            role="menuitem"
            className="workspace-more-menu-item"
            onClick={onDelete}
          >
            {t("common.delete")}
          </button>
        )}
      </div>
    </div>
  );

  const renderFolder = (folder: QuickFolder, depth: number): ReactNode => {
    const isOpen = !collapsed.has(folder.id);
    return (
      <div key={folder.id}>
        <div
          role="button"
          tabIndex={0}
          className={`workspace-tree-row workspace-tree-folder${dropTarget === folder.id ? " workspace-tree-drop" : ""}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          title={folder.name}
          onClick={() => toggleFolder(folder.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleFolder(folder.id);
            }
          }}
          {...dropHandlers(folder.id, folder.id)}
        >
          {isOpen ? (
            <FolderOpenIcon className="workspace-tree-folder-icon" />
          ) : (
            <FolderIcon className="workspace-tree-folder-icon" />
          )}
          <span className="workspace-tree-name">{folder.name}</span>
          {renderAddMenu(
            folder.id,
            t("apiTree.addInFolder", { name: folder.name }),
            t("apiTree.newSubfolder"),
            () => confirmRemoveFolder(folder),
          )}
        </div>
        {isOpen && (
          <>
            {(foldersByParent.get(folder.id) ?? []).map((child) => renderFolder(child, depth + 1))}
            {(requestsByFolder.get(folder.id) ?? []).map((request) =>
              renderRequest(request, depth + 1),
            )}
            {creating?.parentId === folder.id && renderCreateRow(depth + 1)}
          </>
        )}
      </div>
    );
  };

  // 搜索态：平铺展示匹配的快捷请求
  const trimmedKeyword = keyword.trim().toLowerCase();
  if (trimmedKeyword) {
    const matched = requests.filter(
      (request) =>
        request.name.toLowerCase().includes(trimmedKeyword) ||
        request.url.toLowerCase().includes(trimmedKeyword),
    );
    return (
      <div className="workspace-sidebar-tree">
        {matched.length === 0 ? (
          <div className="workspace-sidebar-empty">
            <p className="workspace-sidebar-empty-text">{t("apiTree.noMatch")}</p>
          </div>
        ) : (
          matched.map((request) => renderRequest(request, 0))
        )}
      </div>
    );
  }

  const rootFolders = foldersByParent.get(null) ?? [];
  const rootRequests = requestsByFolder.get(null) ?? [];
  const treeEmpty = folders.length === 0 && requests.length === 0 && !creating;

  return (
    <div
      className={`workspace-sidebar-tree${dropTarget === "quick-root" ? " workspace-tree-drop" : ""}`}
      {...dropHandlers("quick-root", null)}
    >
      {treeEmpty ? (
        <div className="workspace-sidebar-empty">
          <span className="workspace-sidebar-empty-icon">
            <FilePlus2 size={18} />
          </span>
          <p className="workspace-sidebar-empty-text">{t("apiTree.emptyHint")}</p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => beginCreate("request", null)}
          >
            <Plus />
            {t("apiTree.newRequest")}
          </Button>
        </div>
      ) : (
        <>
          {rootFolders.map((folder) => renderFolder(folder, 0))}
          {rootRequests.map((request) => renderRequest(request, 0))}
          {creating?.parentId === null && renderCreateRow(0)}
        </>
      )}
    </div>
  );
});

export default ApiTree;
