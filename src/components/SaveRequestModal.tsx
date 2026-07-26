import { Folder as FolderIcon, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "../i18n";
import { listQuickFolders } from "../lib/quickRequests";
import type { QuickFolder } from "../types/quick";
import "./SaveRequestModal.css";

/** Radix Select 不允许空字符串值，用哨兵值表示根目录 */
const ROOT_VALUE = "__root__";

interface SaveRequestModalProps {
  visible: boolean;
  projectId: string;
  /** 打开时回填的名称（已保存请求再次保存时） */
  initialName?: string;
  /** 打开时回填的目录，null 表示根目录 */
  initialFolderId?: string | null;
  onCancel: () => void;
  /** 确认保存；folderId 为 null 表示根目录 */
  onSave: (name: string, folderId: string | null) => void;
}

/** 按目录树先序展开，depth 用于缩进展示层级 */
function flattenFolders(folders: QuickFolder[]): { folder: QuickFolder; depth: number }[] {
  const byParent = new Map<string | null, QuickFolder[]>();
  for (const folder of folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  const result: { folder: QuickFolder; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      result.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

/** 保存快捷请求弹窗：输入名称并选择存放目录（根目录或任意目录） */
function SaveRequestModal({
  visible,
  projectId,
  initialName,
  initialFolderId,
  onCancel,
  onSave,
}: SaveRequestModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [folderValue, setFolderValue] = useState(ROOT_VALUE);
  const [folders, setFolders] = useState<QuickFolder[]>([]);

  // 每次打开时回填表单并刷新目录列表
  useEffect(() => {
    if (!visible) return;
    setName(initialName ?? "");
    setFolderValue(initialFolderId ?? ROOT_VALUE);
    listQuickFolders(projectId)
      .then(setFolders)
      .catch((error) => console.error("加载目录列表失败", error));
  }, [visible, projectId, initialName, initialFolderId]);

  const options = useMemo(() => flattenFolders(folders), [folders]);
  const trimmedName = name.trim();

  const handleSubmit = () => {
    if (!trimmedName) return;
    onSave(trimmedName, folderValue === ROOT_VALUE ? null : folderValue);
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-[420px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("saveRequest.title")}</DialogTitle>
        </DialogHeader>

        <div className="save-request-form">
          <div className="save-request-field">
            <label className="save-request-label" htmlFor="save-request-name">
              {t("saveRequest.nameLabel")}
            </label>
            <Input
              id="save-request-name"
              autoFocus
              placeholder={t("saveRequest.namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
          <div className="save-request-field">
            <span className="save-request-label">{t("saveRequest.location")}</span>
            <Select value={folderValue} onValueChange={setFolderValue}>
              <SelectTrigger className="w-full" aria-label={t("saveRequest.location")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={ROOT_VALUE}>
                  <Zap className="save-request-option-icon" />
                  <span>{t("saveRequest.root")}</span>
                </SelectItem>
                {options.map(({ folder, depth }) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    <span className="save-request-option" style={{ paddingLeft: depth * 16 }}>
                      <FolderIcon className="save-request-option-icon" />
                      <span>{folder.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!trimmedName} onClick={handleSubmit}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SaveRequestModal;
