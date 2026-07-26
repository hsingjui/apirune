import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "../i18n";
import { readTextFile } from "../lib/files";
import { createQuickFolder, createQuickRequest } from "../lib/quickRequests";
import { type ParsedOpenApi, parseOpenApi } from "../utils/openapi";
import "./OpenApiImportModal.css";

interface OpenApiImportModalProps {
  visible: boolean;
  projectId: string;
  onCancel: () => void;
  /** 导入入库完成后回调，由父组件刷新接口树 */
  onImported: () => void;
}

/** 将解析结果写入快捷请求表：根目录为文档标题，tag 为子目录，无 tag 的接口挂根目录下 */
async function importToQuickTree(projectId: string, parsed: ParsedOpenApi): Promise<void> {
  const root = await createQuickFolder({ projectId, name: parsed.title });
  let folderOrder = 0;
  for (const group of parsed.groups) {
    let folderId = root.id;
    if (group.name !== null) {
      const folder = await createQuickFolder({
        projectId,
        parentId: root.id,
        name: group.name,
        sortOrder: folderOrder++,
      });
      folderId = folder.id;
    }
    for (let i = 0; i < group.operations.length; i++) {
      const op = group.operations[i];
      await createQuickRequest({
        projectId,
        folderId,
        name: op.name,
        method: op.method,
        url: op.url,
        params: op.params,
        headers: op.headers,
        bodyType: op.bodyType,
        body: op.body,
        sortOrder: i,
      });
    }
  }
}

/** OpenAPI 导入弹窗：粘贴 OpenAPI 3.x / Swagger 2.0 文档（JSON/YAML），直接导入为接口树 */
function OpenApiImportModal({ visible, projectId, onCancel, onImported }: OpenApiImportModalProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // 每次打开时重置输入
  useEffect(() => {
    if (visible) {
      setText("");
      setError(null);
      setImporting(false);
    }
  }, [visible]);

  /** 解析文档内容并写入接口树；解析失败在弹窗内提示，成功后关闭弹窗 */
  const importText = async (content: string) => {
    let parsed: ParsedOpenApi;
    try {
      parsed = parseOpenApi(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setImporting(true);
    try {
      await importToQuickTree(projectId, parsed);
      toast.success(t("openapiImport.success", { count: parsed.operationCount }));
      onImported();
    } catch (err) {
      console.error("导入 OpenAPI 失败", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  /** 选择本地 JSON/YAML 文档，读取后直接导入，无需粘贴内容 */
  const handleChooseFile = async () => {
    const path = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "OpenAPI", extensions: ["json", "yaml", "yml"] }],
    });
    if (typeof path !== "string") return;
    let content: string;
    try {
      content = await readTextFile(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    await importText(content);
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-[560px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("openapiImport.title")}</DialogTitle>
        </DialogHeader>

        <div className="openapi-import-form">
          <button
            type="button"
            className="openapi-import-file"
            disabled={importing}
            onClick={handleChooseFile}
          >
            {t("openapiImport.chooseFile")}
            <span className="openapi-import-file-hint">{t("openapiImport.fileHint")}</span>
          </button>
          <div className="openapi-import-divider">{t("openapiImport.orPaste")}</div>
          <textarea
            className="openapi-import-input"
            placeholder={t("openapiImport.placeholder")}
            value={text}
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <p className="openapi-import-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!text.trim() || importing} onClick={() => importText(text)}>
            {t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OpenApiImportModal;
