import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
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
import { getMethodColor } from "../constants/methods";
import { useI18n } from "../i18n";
import { readTextFile } from "../lib/files";
import { sendHttpRequest } from "../lib/http";
import { createQuickFolder, createQuickRequest } from "../lib/quickRequests";
import { type ParsedOpenApi, parseOpenApi } from "../utils/openapi";
import "./OpenApiImportModal.css";

const COMMON_OPENAPI_PATHS = [
  "/v3/api-docs",
  "/v2/api-docs",
  "/swagger.json",
  "/openapi.json",
  "/openapi.yaml",
  "/openapi.yml",
  "/swagger/v1/swagger.json",
] as const;

function normalizeOpenApiUrl(value: string): URL {
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  return url;
}

function isServiceAddress(url: URL): boolean {
  return url.pathname === "/" && !url.search && !url.hash;
}

interface OpenApiImportModalProps {
  visible: boolean;
  projectId: string;
  onCancel: () => void;
  /** 导入入库完成后回调，由父组件刷新请求树 */
  onImported: () => void;
}

/** 将解析结果写入快捷请求表：根目录为文档标题，tag 为子目录，无 tag 的请求挂根目录下 */
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

function operationKey(groupIndex: number, operationIndex: number): string {
  return `${groupIndex}:${operationIndex}`;
}

function allOperationKeys(parsed: ParsedOpenApi): Set<string> {
  return new Set(
    parsed.groups.flatMap((group, groupIndex) =>
      group.operations.map((_, operationIndex) => operationKey(groupIndex, operationIndex)),
    ),
  );
}

function selectOperations(parsed: ParsedOpenApi, selectedKeys: Set<string>): ParsedOpenApi {
  const groups = parsed.groups
    .map((group, groupIndex) => ({
      ...group,
      operations: group.operations.filter((_, operationIndex) =>
        selectedKeys.has(operationKey(groupIndex, operationIndex)),
      ),
    }))
    .filter((group) => group.operations.length > 0);
  return {
    ...parsed,
    groups,
    operationCount: groups.reduce((count, group) => count + group.operations.length, 0),
  };
}

/** OpenAPI 导入弹窗：支持从 URL 或本地文件导入 OpenAPI 3.x / Swagger 2.0 文档 */
function OpenApiImportModal({ visible, projectId, onCancel, onImported }: OpenApiImportModalProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [parsed, setParsed] = useState<ParsedOpenApi | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [importing, setImporting] = useState(false);

  // 每次打开时重置输入
  useEffect(() => {
    if (visible) {
      setUrl("");
      setParsed(null);
      setSelectedKeys(new Set());
      setError(null);
      setLoadingUrl(false);
      setDiscovering(false);
      setImporting(false);
    }
  }, [visible]);

  /** 解析文档内容并写入请求树；解析失败在弹窗内提示，成功后关闭弹窗 */
  const importDocument = async (content: string) => {
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

  const loadDocument = async (documentUrl: string, timeoutMs: number): Promise<ParsedOpenApi> => {
    const response = await sendHttpRequest({
      method: "GET",
      url: documentUrl,
      timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(t("openapiImport.fetchFailed", { status: response.status }));
    }
    if (response.bodyEncoding !== "text") {
      throw new Error(t("openapiImport.nonTextDocument"));
    }
    return parseOpenApi(response.body);
  };

  const discoverDocument = async (serviceUrl: URL) => {
    const candidates = [
      serviceUrl.toString(),
      ...COMMON_OPENAPI_PATHS.map((path) => new URL(path, serviceUrl).toString()),
    ];
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          return { url: candidate, parsed: await loadDocument(candidate, 6_000) };
        } catch {
          return null;
        }
      }),
    );
    return results.find((result) => result !== null) ?? null;
  };

  const handleLoadUrl = async () => {
    let documentUrl: URL;
    try {
      documentUrl = normalizeOpenApiUrl(url.trim());
    } catch {
      setError(t("openapiImport.invalidUrl"));
      return;
    }

    const shouldDiscover = isServiceAddress(documentUrl);
    setError(null);
    setLoadingUrl(true);
    setDiscovering(shouldDiscover);
    try {
      if (shouldDiscover) {
        const found = await discoverDocument(documentUrl);
        if (!found) throw new Error(t("openapiImport.discoveryFailed"));
        setUrl(found.url);
        setParsed(found.parsed);
        setSelectedKeys(allOperationKeys(found.parsed));
        return;
      }

      const nextParsed = await loadDocument(documentUrl.toString(), 30_000);
      setParsed(nextParsed);
      setSelectedKeys(allOperationKeys(nextParsed));
    } catch (err) {
      setParsed(null);
      setSelectedKeys(new Set());
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingUrl(false);
      setDiscovering(false);
    }
  };

  const toggleOperation = (groupIndex: number, operationIndex: number) => {
    const key = operationKey(groupIndex, operationIndex);
    setSelectedKeys((keys) => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllOperations = () => {
    if (!parsed) return;
    setSelectedKeys((keys) =>
      keys.size === parsed.operationCount ? new Set() : allOperationKeys(parsed),
    );
  };

  const importSelected = async () => {
    if (!parsed || selectedKeys.size === 0) return;
    setImporting(true);
    try {
      const selected = selectOperations(parsed, selectedKeys);
      await importToQuickTree(projectId, selected);
      toast.success(t("openapiImport.success", { count: selected.operationCount }));
      onImported();
    } catch (err) {
      console.error("导入 OpenAPI 失败", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  /** 选择本地 JSON/YAML 文档，读取后直接导入 */
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
    await importDocument(content);
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-[720px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("openapiImport.title")}</DialogTitle>
        </DialogHeader>

        <div className="openapi-import-form">
          <div className="openapi-import-url-row">
            <input
              className="openapi-import-url"
              type="url"
              autoFocus
              placeholder={t("openapiImport.urlPlaceholder")}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setParsed(null);
                setSelectedKeys(new Set());
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleLoadUrl();
              }}
              disabled={loadingUrl || importing}
            />
            <Button
              type="button"
              disabled={!url.trim() || loadingUrl || importing}
              onClick={() => void handleLoadUrl()}
            >
              {loadingUrl && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t("openapiImport.loadUrl")}
            </Button>
          </div>

          {discovering && <p className="openapi-import-status">{t("openapiImport.discovering")}</p>}

          {parsed && (
            <div className="openapi-import-preview">
              <div className="openapi-import-preview-header">
                <div>
                  <strong>{parsed.title}</strong>
                  <span>{t("openapiImport.selectedCount", { count: selectedKeys.size })}</span>
                </div>
                <button
                  type="button"
                  className="openapi-import-select-all"
                  disabled={importing}
                  onClick={toggleAllOperations}
                >
                  {selectedKeys.size === parsed.operationCount
                    ? t("openapiImport.clearAll")
                    : t("openapiImport.selectAll")}
                </button>
              </div>
              <div className="openapi-import-operation-list">
                {parsed.groups.map((group, groupIndex) => (
                  <section className="openapi-import-group" key={group.name ?? "untagged"}>
                    <h3>{group.name ?? t("openapiImport.untagged")}</h3>
                    {group.operations.map((operation, operationIndex) => {
                      const key = operationKey(groupIndex, operationIndex);
                      return (
                        <label className="openapi-import-operation" key={key}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(key)}
                            disabled={importing}
                            onChange={() => toggleOperation(groupIndex, operationIndex)}
                          />
                          <span
                            className="openapi-import-method"
                            style={{ color: getMethodColor(operation.method) }}
                          >
                            {operation.method}
                          </span>
                          <span className="openapi-import-operation-info">
                            <strong>{operation.name}</strong>
                            <span>{operation.url}</span>
                          </span>
                        </label>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="openapi-import-file"
            disabled={loadingUrl || importing}
            onClick={handleChooseFile}
          >
            {t("openapiImport.chooseFile")}
            <span className="openapi-import-file-hint">{t("openapiImport.fileHint")}</span>
          </button>
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
          {parsed && (
            <Button
              disabled={selectedKeys.size === 0 || importing}
              onClick={() => void importSelected()}
            >
              {t("openapiImport.importSelected", { count: selectedKeys.size })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OpenApiImportModal;
