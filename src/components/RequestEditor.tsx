import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown,
  Braces,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  SendHorizontal,
  SquarePen,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { getMethodColor, METHODS } from "../constants/methods";
import { useShortcutAction } from "../hooks/useShortcuts";
import { t, useI18n } from "../i18n";
import { getProjectGlobals, upsertEnvVariable, upsertGlobalVariable } from "../lib/environments";
import { addHistory } from "../lib/history";
import {
  cancelHttpRequest,
  clearProjectCookies,
  saveResponseBody,
  sendHttpRequest,
} from "../lib/http";
import { createQuickRequest, updateQuickRequest } from "../lib/quickRequests";
import { loadSettings, toProxyConfig } from "../lib/settings";
import type { Environment } from "../types/environment";
import type { HttpResponseData, SseEvent } from "../types/http";
import type { QuickRequest } from "../types/quick";
import type {
  BodyType,
  FormField,
  FormFieldType,
  HttpMethod,
  KeyValueItem,
} from "../types/request";
import type { CodegenInput } from "../utils/codegen";
import type { ParsedCurl } from "../utils/curl";
import { resolveRequestWithEnv } from "../utils/env";
import { createId } from "../utils/id";
import CodegenModal from "./CodegenModal";
import { JsonEditor, JsonViewer } from "./JsonView";
import SaveRequestModal from "./SaveRequestModal";
import "./RequestEditor.css";

const EDITOR_TABS = ["Params", "Body", "Headers", "Cookies", "Auth", "Settings"] as const;

/** 页签显示名：除 Settings 外均为英文术语，直接展示 */
function editorTabLabel(tab: (typeof EDITOR_TABS)[number]): string {
  return tab === "Settings" ? t("editor.tabSettings") : tab;
}

const BODY_TYPES: BodyType[] = ["none", "json", "form-data", "x-www-form-urlencoded", "raw"];

const RESPONSE_TABS = ["Body", "Cookies", "Headers", "Request"] as const;

/** 响应体视图：美化（JSON 格式化）/ 原始 / 预览（HTML 渲染） */
const BODY_VIEWS = [
  { value: "pretty", labelKey: "editor.viewPretty" },
  { value: "raw", labelKey: "editor.viewRaw" },
  { value: "preview", labelKey: "editor.viewPreview" },
] as const;

type ResponseBodyView = (typeof BODY_VIEWS)[number]["value"];

/** SSE 响应体视图：时间线（逐条事件）/ 原始；pretty 在 SSE 下即时间线 */
const SSE_VIEWS = [
  { value: "pretty", labelKey: "editor.viewTimeline" },
  { value: "raw", labelKey: "editor.viewRaw" },
] as const;

/** 从响应头解析出的单条 Cookie */
interface ResponseCookie {
  name: string;
  value: string;
  attributes: string;
}

/** 响应区拖拽到低于此高度时自动折叠 */
const RESPONSE_COLLAPSE_HEIGHT = 100;

interface QueryParam {
  key: string;
  value: string;
}

/** 表单行：在键值对之上增加字段类型与 array 多值 */
interface FormRow extends QueryParam {
  /** 缺省 text */
  fieldType?: FormFieldType;
  /** array 类型的多个值 */
  values?: string[];
}

interface RequestEditorProps {
  /** 所属项目，用于记录请求历史 */
  projectId: string;
  /** 当前选中的环境；发送时应用前置 URL 与环境变量，null 表示未选择 */
  environment?: Environment | null;
  /** 是否为当前激活标签：多个编辑器常驻挂载，仅激活者响应快捷键 */
  active?: boolean;
  /** 初始请求配置（如 curl 导入的解析结果），仅首次渲染时生效 */
  initial?: ParsedCurl;
  /** 已保存快捷请求的 id；有值时保存为更新而非新建 */
  requestId?: string;
  /** 已保存的请求名称，保存弹窗回填 */
  requestName?: string;
  /** 已保存请求所在目录，null 表示根目录 */
  initialFolderId?: string | null;
  /** 保存成功回调，由父组件同步标签名并刷新接口树 */
  onSaved?: (request: QuickRequest) => void;
  /** 环境变量变更回调（如响应提取变量后），由父组件重新加载环境列表 */
  onEnvChanged?: () => void;
}

/** KeyValueItem[] → 编辑器内部键值对 */
function toPairs(items?: KeyValueItem[]): QueryParam[] {
  return (items ?? []).map(({ key, value }) => ({ key, value }));
}

/** 编辑器内部键值对 → 发送用 KeyValueItem[]（过滤空 key） */
function toItems(pairs: QueryParam[]): KeyValueItem[] {
  return pairs.filter((pair) => pair.key).map((pair) => ({ ...pair, enabled: true }));
}

/** 编辑器表单行 → 发送用 FormField[]（过滤空 key，array 过滤空值） */
function toFormFields(rows: FormRow[]): FormField[] {
  return rows
    .filter((row) => row.key)
    .map((row) => ({
      key: row.key,
      value: row.value,
      enabled: true,
      ...(row.fieldType && row.fieldType !== "text" ? { fieldType: row.fieldType } : {}),
      ...(row.fieldType === "array" ? { values: (row.values ?? []).filter(Boolean) } : {}),
    }));
}

/** Cookie 请求头值 → 编辑器内部键值对（按 ; 拆分，每条按首个 = 拆键值） */
function parseCookiePairs(value: string): QueryParam[] {
  return value
    .split(";")
    .map((pair) => {
      const at = pair.indexOf("=");
      return {
        key: (at === -1 ? pair : pair.slice(0, at)).trim(),
        value: at === -1 ? "" : pair.slice(at + 1).trim(),
      };
    })
    .filter((pair) => pair.key);
}

/** 编辑器 Cookie 行 → Cookie 请求头值（过滤空 key） */
function serializeCookies(pairs: QueryParam[]): string {
  return pairs
    .filter((pair) => pair.key)
    .map((pair) => `${pair.key}=${pair.value}`)
    .join("; ");
}

/** 路径参数占位符：单层花括号 {name}，不匹配环境变量的 {{name}} */
const PATH_PARAM_PATTERN = /(?<!\{)\{([^{}\s/]+)\}(?!\})/g;

/** 从 URL 中提取路径参数名（按出现顺序去重） */
function extractPathParamNames(url: string): string[] {
  const names: string[] = [];
  for (const match of url.matchAll(PATH_PARAM_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** 用路径参数值替换 URL 中的 {name} 占位符；未填值时保留原样 */
function applyPathParams(url: string, pairs: QueryParam[]): string {
  return url.replace(PATH_PARAM_PATTERN, (raw, name: string) => {
    const value = pairs.find((pair) => pair.key === name)?.value;
    return value ? value : raw;
  });
}

/** 初始文本请求体：JSON 尝试格式化展示 */
function initBodyText(initial?: ParsedCurl): string {
  if (!initial || initial.bodyType === "none") return "";
  if (initial.bodyType === "form-data" || initial.bodyType === "x-www-form-urlencoded") return "";
  if (initial.bodyType === "json") {
    try {
      return JSON.stringify(JSON.parse(initial.body), null, 2);
    } catch {
      // 非法 JSON 时原样展示
    }
  }
  return initial.body;
}

/** 初始表单请求体：form 类 body 为 FormField[] 的 JSON 串 */
function initFormItems(initial?: ParsedCurl): FormRow[] {
  if (initial?.bodyType !== "form-data" && initial?.bodyType !== "x-www-form-urlencoded") return [];
  try {
    return (JSON.parse(initial.body) as FormField[]).map(({ key, value, fieldType, values }) => ({
      key,
      value,
      ...(fieldType ? { fieldType } : {}),
      ...(values ? { values } : {}),
    }));
  } catch {
    return [];
  }
}

/** 快捷请求编辑器：请求行 + 参数配置页签 + 返回响应区 */
function RequestEditor({
  projectId,
  environment = null,
  active = false,
  initial,
  requestId,
  requestName,
  initialFolderId,
  onSaved,
  onEnvChanged,
}: RequestEditorProps) {
  useI18n();
  const [method, setMethod] = useState<string>(initial?.method ?? "GET");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [activeTab, setActiveTab] = useState<(typeof EDITOR_TABS)[number]>("Params");
  const [params, setParams] = useState<QueryParam[]>(() =>
    toPairs(initial?.params?.filter((item) => item.type !== "path")),
  );
  // 路径参数：参数名由 URL 中的 {name} 占位符推导，保存时随 params 持久化（type: "path"）
  const [pathParams, setPathParams] = useState<QueryParam[]>(() => {
    const saved = initial?.params?.filter((item) => item.type === "path") ?? [];
    return extractPathParamNames(initial?.url ?? "").map((name) => ({
      key: name,
      value: saved.find((item) => item.key === name)?.value ?? "",
    }));
  });
  // Cookie 请求头拆为独立的 Cookies 页签编辑，Headers 中不再重复展示
  const [headers, setHeaders] = useState<QueryParam[]>(() =>
    toPairs(initial?.headers?.filter((item) => item.key.toLowerCase() !== "cookie")),
  );
  const [cookies, setCookies] = useState<QueryParam[]>(() =>
    (initial?.headers ?? [])
      .filter((item) => item.key.toLowerCase() === "cookie")
      .flatMap((item) => parseCookiePairs(item.value)),
  );
  const [bodyType, setBodyType] = useState<BodyType>(initial?.bodyType ?? "none");
  const [bodyText, setBodyText] = useState(() => initBodyText(initial));
  const [formItems, setFormItems] = useState<FormRow[]>(() => initFormItems(initial));
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);
  const [responseTab, setResponseTab] = useState<(typeof RESPONSE_TABS)[number]>("Body");
  const [bodyView, setBodyView] = useState<ResponseBodyView>("pretty");
  // SSE 流式事件：发送时清空，后端边收边推；非 SSE 响应始终为空
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  // 时间线选中项；null 表示跟随最新一条
  const [sseSelected, setSseSelected] = useState<number | null>(null);
  // 拖拽调整后的响应区高度；null 表示未拖拽过，按默认 max-height 自适应
  const [responseHeight, setResponseHeight] = useState<number | null>(null);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  // 生成代码弹窗：input 为打开时计算的请求快照
  const [codegenVisible, setCodegenVisible] = useState(false);
  const [codegenInput, setCodegenInput] = useState<CodegenInput | null>(null);
  // 响应区右键菜单与「设为变量」弹窗
  const [varMenu, setVarMenu] = useState<{ x: number; y: number; value: string } | null>(null);
  const [varModalOpen, setVarModalOpen] = useState(false);
  const [varName, setVarName] = useState("");
  const [varValue, setVarValue] = useState("");
  const [varScope, setVarScope] = useState<"env" | "global">("global");
  const responseRef = useRef<HTMLElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // 新建的空白请求：挂载后默认聚焦 URL 输入框，便于直接输入地址
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载时聚焦一次，后续变化不应重新聚焦
  useEffect(() => {
    if (active && !initial?.url) urlInputRef.current?.focus();
  }, []);
  // 发送序号：取消时自增使旧请求的结果失效
  const sendSeqRef = useRef(0);
  // 进行中请求的取消标识，取消时通知后端中断请求
  const cancelIdRef = useRef<string | null>(null);

  // URL 变化时同步路径参数：新占位符补空行，已移除的删掉，同名保留已填值
  useEffect(() => {
    setPathParams((prev) => {
      const names = extractPathParamNames(url);
      if (names.length === prev.length && names.every((name, i) => prev[i].key === name)) {
        return prev;
      }
      return names.map((name) => ({
        key: name,
        value: prev.find((pair) => pair.key === name)?.value ?? "",
      }));
    });
  }, [url]);

  /** 拖拽响应区顶缘调整高度：最高为编辑器一半，向下拖过阈值则折叠，折叠后仍可拖开 */
  const startResponseResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const el = responseRef.current;
    const startHeight = el?.offsetHeight ?? 0;
    const maxHeight = (el?.parentElement?.clientHeight ?? 600) / 2;
    const onMove = (e: PointerEvent) => {
      const next = startHeight + (startY - e.clientY);
      if (next < RESPONSE_COLLAPSE_HEIGHT) {
        setResponseOpen(false);
        return;
      }
      setResponseOpen(true);
      setResponseHeight(Math.min(maxHeight, next));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-response-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("is-response-resizing");
  };

  const methodColor = getMethodColor(method);
  /** 响应状态摘要：状态码 / 耗时 / 大小，折叠与展开的头部共用 */
  const responseMeta = response && (
    <span className="request-response-meta">
      <span className={`request-response-status${response.status < 400 ? " is-ok" : " is-fail"}`}>
        {response.status} {response.statusText}
      </span>
      <span>{response.durationMs} ms</span>
      <span>{formatSize(response.sizeBytes)}</span>
    </span>
  );
  const isFormBody = bodyType === "form-data" || bodyType === "x-www-form-urlencoded";
  // 大响应体的 parse + stringify 开销大，仅在响应变化时重算，避免输入时每次渲染都重新序列化
  const responseJson = useMemo(() => (response ? formatJsonBody(response) : null), [response]);
  const responseCookies = useMemo(
    () => (response ? parseSetCookies(response.headers) : []),
    [response],
  );
  // 二进制响应：图片类型生成 data URL 预览，其余提示保存到文件
  const isBinaryResponse = response?.bodyEncoding === "base64";
  const imageDataUrl = useMemo(() => {
    if (!response || response.bodyEncoding !== "base64") return null;
    const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    return contentType.startsWith("image/") ? `data:${contentType};base64,${response.body}` : null;
  }, [response]);

  /** 汇总当前编辑器内容为请求配置（发送 / 保存共用）；路径参数以 type: "path" 标记存入 params */
  const buildRequestInput = () => ({
    method: method as HttpMethod,
    url: url.trim(),
    params: [
      ...toItems(params),
      ...pathParams.map((pair) => ({ ...pair, enabled: true, type: "path" as const })),
    ],
    // Cookies 页签的行合并为单个 Cookie 请求头
    headers: [
      ...toItems(headers),
      ...(cookies.some((pair) => pair.key)
        ? [{ key: "Cookie", value: serializeCookies(cookies), enabled: true }]
        : []),
    ],
    bodyType,
    body: isFormBody
      ? JSON.stringify(toFormFields(formItems))
      : bodyType === "none"
        ? ""
        : bodyText,
  });

  const handleSend = async () => {
    if (!url.trim() && !environment?.baseUrl.trim()) {
      toast.warning(t("editor.enterUrlFirst"));
      return;
    }
    const seq = ++sendSeqRef.current;
    setSending(true);
    setResponseOpen(true);
    setResponse(null);
    setResponseError(null);
    setSseEvents([]);
    setSseSelected(null);
    // 发送前读取全局设置（超时 / SSL / 重定向 / 无缓存头）与环境配置：全局变量 / 全局参数 + 当前环境的前置 URL 与环境变量
    const appSettings = loadSettings();
    let input = {
      ...buildRequestInput(),
      // 发送时将路径参数值替入 URL，params 仅保留 Query 参数，避免后端拼接成查询串
      url: applyPathParams(url.trim(), pathParams),
      params: toItems(params),
      timeoutMs: appSettings.requestTimeoutMs,
      sslVerify: appSettings.sslVerify,
      followRedirects: appSettings.followRedirects,
      noCacheHeader: appSettings.noCacheHeader,
      proxy: toProxyConfig(appSettings),
      // 会话 Cookie 按项目隔离：后端自动记住 Set-Cookie 并在后续请求回发
      cookieJarId: projectId,
    };
    try {
      const globals = await getProjectGlobals(projectId);
      input = { ...input, ...resolveRequestWithEnv(input, environment, globals) };
    } catch (err) {
      console.error("读取环境配置失败", err);
    }
    let result: HttpResponseData | null = null;
    let error: string | null = null;
    try {
      // cancelId 仅用于后端中断，不并入 input，避免随历史记录持久化
      const cancelId = createId();
      cancelIdRef.current = cancelId;
      result = await sendHttpRequest({ ...input, cancelId }, (event) => {
        // SSE 事件逐条追加到时间线；已取消 / 新请求已发出时丢弃
        if (seq === sendSeqRef.current) setSseEvents((prev) => [...prev, event]);
      });
      if (seq !== sendSeqRef.current) return; // 已取消，忽略结果
      setResponse(result);
    } catch (err) {
      if (seq !== sendSeqRef.current) return; // 已取消，忽略错误
      error = String(err);
      setResponseError(error);
    } finally {
      if (seq === sendSeqRef.current) {
        setSending(false);
        cancelIdRef.current = null;
      }
    }
    // 记录历史（失败不影响主流程）
    try {
      await addHistory({
        projectId,
        requestId: null,
        ...input,
        status: result?.status ?? null,
        durationMs: result?.durationMs ?? null,
        responseHeaders: result?.headers ?? {},
        responseBody: result?.body ?? "",
        responseBodyEncoding: result?.bodyEncoding ?? "text",
        error,
      });
    } catch (err) {
      console.error("记录请求历史失败:", err);
    }
  };

  /** 取消发送：使当前请求的结果失效、退出加载态，并通知后端中断请求 */
  const handleCancelSend = () => {
    sendSeqRef.current += 1;
    setSending(false);
    if (cancelIdRef.current) {
      cancelHttpRequest(cancelIdRef.current).catch((err) => {
        console.error("中断请求失败", err);
      });
      cancelIdRef.current = null;
    }
  };

  // 发送中按 Esc 取消发送（仅当前激活标签响应）
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleCancelSend 仅依赖 ref 与 setState
  useEffect(() => {
    if (!sending || !active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleCancelSend();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sending, active]);

  /** 确认保存：已保存过则更新原请求，否则在所选目录下新建 */
  const handleSaveConfirm = async (name: string, folderId: string | null) => {
    try {
      const saved = requestId
        ? await updateQuickRequest(requestId, { name, folderId, ...buildRequestInput() })
        : await createQuickRequest({ projectId, name, folderId, ...buildRequestInput() });
      setSaveModalVisible(false);
      toast.success(t("editor.saveSuccess"));
      onSaved?.(saved);
    } catch (error) {
      console.error("保存快捷请求失败", error);
      toast.error(t("editor.saveFailed"));
    }
  };

  /** 保存入口：已保存过的请求直接更新内容（名称与目录不变），否则弹窗输入名称 */
  const handleSave = async () => {
    if (!requestId) {
      setSaveModalVisible(true);
      return;
    }
    try {
      const saved = await updateQuickRequest(requestId, buildRequestInput());
      toast.success(t("editor.saveSuccess"));
      onSaved?.(saved);
    } catch (error) {
      console.error("保存快捷请求失败", error);
      toast.error(t("editor.saveFailed"));
    }
  };

  /** 格式化 JSON 请求体 */
  const handleFormatBody = () => {
    if (!bodyText.trim()) return;
    try {
      setBodyText(JSON.stringify(JSON.parse(bodyText), null, 2));
    } catch {
      toast.warning(t("editor.invalidJson"));
    }
  };

  /** 将响应体保存到本地文件（二进制 / 文本均可） */
  const handleSaveBody = async () => {
    if (!response) return;
    const path = await saveFileDialog({
      defaultPath: suggestFileName(url.trim(), response.headers),
    });
    if (!path) return;
    try {
      await saveResponseBody(path, response.body, response.bodyEncoding);
      toast.success(t("editor.saveFileDone"));
    } catch (err) {
      console.error("保存响应到文件失败", err);
      toast.error(t("editor.saveFileFailed"));
    }
  };

  /** 清除本项目的会话 Cookie */
  const handleClearCookies = async () => {
    try {
      await clearProjectCookies(projectId);
      toast.success(t("editor.clearCookiesDone"));
    } catch (err) {
      console.error("清除会话 Cookie 失败", err);
      toast.error(String(err));
    }
  };

  /** 响应区右键：选中文本时弹出「设为变量」菜单 */
  const handleResponseContextMenu = (event: React.MouseEvent) => {
    const value = cleanSelection(window.getSelection()?.toString() ?? "");
    if (!value) return;
    event.preventDefault();
    setVarMenu({ x: event.clientX, y: event.clientY, value });
  };

  /** 打开设为变量弹窗，预填选中的值；默认存入当前环境，未选环境时存入全局 */
  const openVarModal = () => {
    if (!varMenu) return;
    setVarName("");
    setVarValue(varMenu.value);
    setVarScope(environment ? "env" : "global");
    setVarMenu(null);
    setVarModalOpen(true);
  };

  /** 保存提取的变量到当前环境 / 项目全局变量 */
  const handleVarSave = async () => {
    const name = varName.trim();
    if (!name) {
      toast.warning(t("editor.varNameRequired"));
      return;
    }
    try {
      if (varScope === "env" && environment) {
        await upsertEnvVariable(environment.id, name, varValue);
        onEnvChanged?.();
      } else {
        await upsertGlobalVariable(projectId, name, varValue);
      }
      setVarModalOpen(false);
      toast.success(t("editor.varSaved", { name }));
    } catch (err) {
      console.error("保存变量失败", err);
      toast.error(t("editor.varSaveFailed"));
    }
  };

  /** 打开生成代码弹窗：与发送一致，先替入路径参数并应用环境配置 */
  const handleOpenCodegen = async () => {
    let input: CodegenInput = {
      ...buildRequestInput(),
      url: applyPathParams(url.trim(), pathParams),
      params: toItems(params),
    };
    try {
      const globals = await getProjectGlobals(projectId);
      const resolved = resolveRequestWithEnv(input, environment, globals);
      input = {
        ...input,
        url: resolved.url,
        params: resolved.params,
        headers: resolved.headers,
        body: resolved.body,
      };
    } catch (err) {
      console.error("读取环境配置失败", err);
    }
    setCodegenInput(input);
    setCodegenVisible(true);
  };

  // 快捷键：发送请求
  useShortcutAction("sendRequest", () => {
    if (active && !sending) void handleSend();
  });

  // 快捷键：保存请求
  useShortcutAction("saveRequest", () => {
    if (active) void handleSave();
  });

  return (
    <div className="request-editor">
      {/* 发送中遮罩：覆盖整个请求模块，可取消发送；SSE 事件开始到达后隐藏，便于实时查看时间线 */}
      {sending && sseEvents.length === 0 && (
        <div className="request-sending-overlay">
          <Loader2 className="request-sending-spinner" aria-hidden="true" />
          <span className="request-sending-text">{t("editor.sending")}</span>
          <Button variant="outline" size="sm" onClick={handleCancelSend}>
            {t("editor.cancelSend")}
            <kbd className="request-sending-kbd">Esc</kbd>
          </Button>
        </div>
      )}
      {/* 请求行：方法 + URL + 操作按钮 */}
      <div className="request-line">
        <div className="request-url-group">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="request-method" aria-label={t("editor.methodAria")}>
              <span className="request-method-text" style={{ color: methodColor }}>
                {method}
              </span>
            </SelectTrigger>
            <SelectContent position="popper">
              {METHODS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  <span className="request-method-text" style={{ color: entry.color }}>
                    {entry.value}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={urlInputRef}
            className="request-url"
            placeholder={
              environment?.baseUrl.trim()
                ? t("editor.urlPlaceholderWithBase", { base: environment.baseUrl.trim() })
                : t("editor.urlPlaceholder")
            }
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            style={{ ["--request-method-color" as string]: methodColor }}
          />
        </div>
        <Button disabled={sending} onClick={handleSend}>
          <SendHorizontal />
          {t("editor.send")}
        </Button>
        <Button variant="outline" onClick={handleSave}>
          {t("common.save")}
        </Button>
      </div>

      <SaveRequestModal
        visible={saveModalVisible}
        projectId={projectId}
        initialName={requestName}
        initialFolderId={initialFolderId}
        onCancel={() => setSaveModalVisible(false)}
        onSave={handleSaveConfirm}
      />

      <CodegenModal
        visible={codegenVisible}
        input={codegenInput}
        onClose={() => setCodegenVisible(false)}
      />

      {/* 配置页签 */}
      <div className="request-tabs" role="tablist">
        {EDITOR_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`request-tab${activeTab === tab ? " request-tab-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {editorTabLabel(tab)}
            {tab === "Params" && params.length + pathParams.length > 0 && (
              <span className="request-tab-count">{params.length + pathParams.length}</span>
            )}
            {tab === "Headers" && headers.length > 0 && (
              <span className="request-tab-count">{headers.length}</span>
            )}
            {tab === "Cookies" && cookies.length > 0 && (
              <span className="request-tab-count">{cookies.length}</span>
            )}
            {tab === "Body" && bodyType !== "none" && (
              <span className="request-tab-dot" aria-hidden="true" />
            )}
          </button>
        ))}
        <button
          type="button"
          className="request-tab-codegen"
          onClick={() => void handleOpenCodegen()}
        >
          <Code2 aria-hidden="true" />
          {t("editor.generateCode")}
        </button>
      </div>

      {/* 页签内容；JSON 请求体时编辑器填满剩余高度，随响应区拖拽同步伸缩 */}
      <div
        className={`request-panel${activeTab === "Body" && bodyType === "json" ? " request-panel-flush" : ""}`}
      >
        {activeTab === "Params" ? (
          <>
            <KeyValueTable title={t("editor.queryParams")} items={params} onChange={setParams} />
            {pathParams.length > 0 && (
              <PathParamTable items={pathParams} onChange={setPathParams} />
            )}
          </>
        ) : activeTab === "Headers" ? (
          <KeyValueTable
            title={t("editor.headersTitle")}
            items={headers}
            onChange={setHeaders}
            keyPlaceholder={t("editor.headerKey")}
            valuePlaceholder={t("editor.headerValue")}
          />
        ) : activeTab === "Cookies" ? (
          <>
            <KeyValueTable
              title={t("editor.cookiesTitle")}
              items={cookies}
              onChange={setCookies}
              keyPlaceholder={t("editor.cookieKey")}
              valuePlaceholder={t("editor.cookieValue")}
            />
            <div className="request-cookies-panel">
              <p className="request-cookies-hint">{t("editor.cookieJarHint")}</p>
              <Button variant="outline" size="sm" onClick={handleClearCookies}>
                <Trash2 aria-hidden="true" />
                {t("editor.clearCookies")}
              </Button>
            </div>
          </>
        ) : activeTab === "Body" ? (
          <section className="request-body">
            <div className="request-body-toolbar">
              <div
                className="request-body-types"
                role="radiogroup"
                aria-label={t("editor.bodyTypeAria")}
              >
                {BODY_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={bodyType === type}
                    className={`request-body-type${bodyType === type ? " request-body-type-active" : ""}`}
                    onClick={() => setBodyType(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
              {bodyType === "json" && (
                <button type="button" className="request-body-format" onClick={handleFormatBody}>
                  <Braces aria-hidden="true" />
                  {t("editor.format")}
                </button>
              )}
            </div>
            {bodyType === "none" ? (
              <div className="request-panel-placeholder">{t("editor.noBody")}</div>
            ) : isFormBody ? (
              <KeyValueTable
                title={t("editor.formFields")}
                items={formItems}
                onChange={setFormItems}
                keyPlaceholder={t("editor.fieldKey")}
                valuePlaceholder={t("editor.fieldValue")}
                fieldTypes={
                  bodyType === "form-data" ? ["text", "file", "array"] : ["text", "array"]
                }
              />
            ) : bodyType === "json" ? (
              <JsonEditor
                value={bodyText}
                onChange={setBodyText}
                placeholder={t("editor.jsonPlaceholder")}
              />
            ) : (
              <textarea
                className="request-body-text"
                placeholder={t("editor.rawPlaceholder")}
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                spellCheck={false}
              />
            )}
          </section>
        ) : (
          <div className="request-panel-placeholder">
            {t("editor.wip", { tab: editorTabLabel(activeTab) })}
          </div>
        )}
      </div>

      {/* 返回响应 */}
      <footer
        ref={responseRef}
        className={`request-response${responseOpen ? " is-open" : ""}`}
        style={responseOpen && responseHeight !== null ? { height: responseHeight } : undefined}
        onContextMenu={handleResponseContextMenu}
      >
        {/* 顶缘拖拽手柄：折叠状态下也可向上拖开 */}
        <div
          className="request-response-resizer"
          aria-hidden="true"
          onPointerDown={startResponseResize}
        />
        {responseOpen && response && !responseError ? (
          /* 展开时头部换为页签行：箭头可折叠，“返回响应”标题隐藏 */
          <div className="request-response-head is-expanded">
            <button
              type="button"
              className="request-response-toggle"
              aria-label={t("editor.response")}
              onClick={() => setResponseOpen(false)}
            >
              <ChevronRight className="request-response-chevron" aria-hidden="true" />
            </button>
            <div className="response-tabs" role="tablist">
              {RESPONSE_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={responseTab === tab}
                  className={`response-tab${responseTab === tab ? " response-tab-active" : ""}`}
                  onClick={() => setResponseTab(tab)}
                >
                  {tab === "Request" ? t("editor.actualRequest") : tab}
                  {tab === "Cookies" && responseCookies.length > 0 && (
                    <span className="request-tab-count">{responseCookies.length}</span>
                  )}
                  {tab === "Headers" && (
                    <span className="request-tab-count">
                      {Object.keys(response.headers).length}
                    </span>
                  )}
                </button>
              ))}
              {responseTab === "Body" && !isBinaryResponse && (
                <div
                  className="response-views"
                  role="radiogroup"
                  aria-label={t("editor.bodyViewAria")}
                >
                  {(sseEvents.length > 0 ? SSE_VIEWS : BODY_VIEWS).map((view) => (
                    <button
                      key={view.value}
                      type="button"
                      role="radio"
                      aria-checked={bodyView === view.value}
                      className={`response-view${bodyView === view.value ? " response-view-active" : ""}`}
                      onClick={() => setBodyView(view.value)}
                    >
                      {t(view.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {responseMeta}
          </div>
        ) : (
          <button
            type="button"
            className="request-response-head"
            onClick={() => setResponseOpen((open) => !open)}
          >
            <ChevronRight className="request-response-chevron" aria-hidden="true" />
            <span className="request-response-title">{t("editor.response")}</span>
            {responseMeta}
          </button>
        )}
        {!responseOpen ? null : responseError ? (
          <pre className="request-response-body request-response-error">{responseError}</pre>
        ) : response ? (
          <>
            {responseTab === "Request" ? (
              <div className="request-response-body response-actual">
                <p className="response-actual-label">{t("editor.requestUrl")}:</p>
                <div className="response-actual-url">
                  <span
                    className="response-actual-method"
                    style={{ color: getMethodColor(response.requestMethod) }}
                  >
                    {response.requestMethod}
                  </span>
                  <span className="response-actual-href">{response.requestUrl}</span>
                </div>
                <p className="response-actual-label">Header:</p>
                <table className="response-table">
                  <thead>
                    <tr>
                      <th>{t("common.name")}</th>
                      <th>{t("common.value")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(response.requestHeaders ?? {}).map(([name, value]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : responseTab === "Headers" ? (
              <ResponseTable
                columns={[t("common.name"), t("common.value")]}
                rows={Object.entries(response.headers)}
              />
            ) : responseTab === "Cookies" ? (
              responseCookies.length > 0 ? (
                <ResponseTable
                  columns={[t("common.name"), t("common.value"), t("editor.colAttributes")]}
                  rows={responseCookies.map((c) => [c.name, c.value, c.attributes])}
                />
              ) : (
                <div className="request-response-body request-response-empty">
                  {t("editor.noSetCookie")}
                </div>
              )
            ) : sseEvents.length > 0 && bodyView !== "raw" ? (
              <SseTimeline events={sseEvents} selected={sseSelected} onSelect={setSseSelected} />
            ) : isBinaryResponse ? (
              <div className="request-response-body request-response-binary">
                {imageDataUrl ? (
                  <img className="response-binary-image" src={imageDataUrl} alt="" />
                ) : (
                  <p className="response-binary-hint">
                    {t("editor.binaryBody", { size: formatSize(response.sizeBytes) })}
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={handleSaveBody}>
                  <Download aria-hidden="true" />
                  {t("editor.saveToFile")}
                </Button>
              </div>
            ) : bodyView === "raw" ? (
              <pre className="request-response-body">{response.body}</pre>
            ) : bodyView === "preview" ? (
              <iframe
                className="request-response-body request-response-preview"
                title={t("editor.previewTitle")}
                sandbox=""
                srcDoc={response.body}
              />
            ) : responseJson !== null ? (
              <div className="request-response-body request-response-json">
                <JsonViewer value={responseJson} />
              </div>
            ) : (
              <pre className="request-response-body">{response.body}</pre>
            )}
          </>
        ) : sending || sseEvents.length > 0 ? (
          // 流式接收中（或取消后保留已收事件）：直接展示时间线
          sseEvents.length > 0 ? (
            <SseTimeline events={sseEvents} selected={sseSelected} onSelect={setSseSelected} />
          ) : (
            <span className="request-response-hint">{t("editor.sending")}</span>
          )
        ) : (
          <div className="request-response-body request-response-empty">
            {t("editor.emptyResponse")}
          </div>
        )}
      </footer>

      {/* 响应区右键菜单：选中文本设为变量 */}
      {varMenu && (
        <div
          className="response-var-overlay"
          onMouseDown={() => setVarMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setVarMenu(null);
          }}
        >
          <div
            className="response-var-menu"
            style={{ left: varMenu.x, top: varMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="response-var-menu-item" onClick={openVarModal}>
              {t("editor.setAsVariable")}
            </button>
          </div>
        </div>
      )}

      {/* 设为变量弹窗 */}
      <Dialog open={varModalOpen} onOpenChange={(open) => !open && setVarModalOpen(false)}>
        <DialogContent className="sm:max-w-[440px]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("editor.setAsVariable")}</DialogTitle>
          </DialogHeader>
          <div className="response-var-form">
            <label className="response-var-field">
              <span>{t("editor.varName")}</span>
              <input
                autoFocus
                value={varName}
                onChange={(event) => setVarName(event.target.value)}
                placeholder={t("editor.varNamePlaceholder")}
              />
            </label>
            <label className="response-var-field">
              <span>{t("editor.varValue")}</span>
              <textarea
                value={varValue}
                spellCheck={false}
                onChange={(event) => setVarValue(event.target.value)}
              />
            </label>
            <div className="response-var-field">
              <span>{t("editor.varScope")}</span>
              <Select
                value={varScope}
                onValueChange={(value) => setVarScope(value as "env" | "global")}
              >
                <SelectTrigger className="response-var-scope">
                  {varScope === "env"
                    ? t("editor.varScopeEnv", { name: environment?.name ?? "" })
                    : t("editor.varScopeGlobal")}
                </SelectTrigger>
                <SelectContent position="popper">
                  {environment && (
                    <SelectItem value="env">
                      {t("editor.varScopeEnv", { name: environment.name })}
                    </SelectItem>
                  )}
                  <SelectItem value="global">{t("editor.varScopeGlobal")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVarModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleVarSave}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 批量编辑的分隔模式：逗号 / 冒号 */
const BATCH_MODES = [
  { value: "comma", labelKey: "editor.batchModeComma", separator: "," },
  { value: "colon", labelKey: "editor.batchModeColon", separator: ":" },
] as const;

type BatchMode = (typeof BATCH_MODES)[number]["value"];

function batchSeparator(mode: BatchMode): string {
  return BATCH_MODES.find((item) => item.value === mode)!.separator;
}

/** 键值对 → 批量编辑文本，每行一条记录 */
function serializeBatch(items: QueryParam[], separator: string): string {
  return items
    .filter((item) => item.key || item.value)
    .map((item) => (item.value ? `${item.key}${separator}${item.value}` : item.key))
    .join("\n");
}

/** 批量编辑文本 → 键值对；仅按每行首个分隔符拆分，参数值可包含分隔符 */
function parseBatch(text: string, separator: string): QueryParam[] {
  return text
    .split("\n")
    .map((line) => {
      const at = line.indexOf(separator);
      return {
        key: (at === -1 ? line : line.slice(0, at)).trim(),
        value: at === -1 ? "" : line.slice(at + 1).trim(),
      };
    })
    .filter((item) => item.key);
}

/** 批量编辑弹窗：文本方式编辑全部键值对，支持逗号 / 冒号分隔 */
function BatchEditModal({
  visible,
  items,
  keyPlaceholder,
  valuePlaceholder,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  items: QueryParam[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  onCancel: () => void;
  onConfirm: (items: QueryParam[]) => void;
}) {
  const [mode, setMode] = useState<BatchMode>("comma");
  const [text, setText] = useState("");

  // 每次打开时按当前条目回填文本，默认逗号模式
  useEffect(() => {
    if (!visible) return;
    setMode("comma");
    setText(serializeBatch(items, ","));
  }, [visible, items]);

  const separator = batchSeparator(mode);

  /** 切换模式时按新分隔符重排现有文本 */
  const switchMode = (next: BatchMode) => {
    if (next === mode) return;
    setText(serializeBatch(parseBatch(text, separator), batchSeparator(next)));
    setMode(next);
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[520px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("editor.batchEdit")}</DialogTitle>
        </DialogHeader>

        <div className="batch-edit-toolbar">
          <div
            className="batch-edit-modes"
            role="radiogroup"
            aria-label={t("editor.batchModeAria")}
          >
            {BATCH_MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={mode === item.value}
                className={`batch-edit-mode${mode === item.value ? " batch-edit-mode-active" : ""}`}
                onClick={() => switchMode(item.value)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <span className="batch-edit-format">
            {t("editor.batchFormat")} {keyPlaceholder}
            {separator}
            {valuePlaceholder}
          </span>
        </div>

        <div className="batch-edit-body">
          <textarea
            className="batch-edit-text"
            autoFocus
            spellCheck={false}
            placeholder={`${keyPlaceholder}${separator}${valuePlaceholder}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="batch-edit-hint">
            {t("editor.batchHint", {
              key: keyPlaceholder,
              value: valuePlaceholder,
              sep: mode === "comma" ? t("editor.sepComma") : t("editor.sepColon"),
            })}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onConfirm(parseBatch(text, separator))}>
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 从文件路径中取文件名（兼容 / 与 \ 分隔） */
function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** 可编辑键值对表格，末尾带自动追加的占位行，Params / Headers / 表单共用；
 * 传入 fieldTypes 时为表单模式，每行增加类型列（text / file / array） */
function KeyValueTable({
  title,
  items,
  onChange,
  keyPlaceholder = t("editor.paramKey"),
  valuePlaceholder = t("editor.paramValue"),
  fieldTypes,
}: {
  title: string;
  items: FormRow[];
  onChange: (items: FormRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** 可选的字段类型列表；缺省不显示类型列 */
  fieldTypes?: FormFieldType[];
}) {
  const typed = !!fieldTypes;
  const tableRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  /** 悬停行下标；用 pointer 事件驱动，规避 macOS WKWebView 的 :hover 状态残留 */
  const [hoverRow, setHoverRow] = useState(-1);
  /** 当前悬停行的 DOM；供全局 pointermove 兑底判断指针是否已离开 */
  const hoverRowRef = useRef<HTMLDivElement | null>(null);

  /** WKWebView 可能丢失 pointerleave，甚至停发 pointer 事件（如停留出现原生 tooltip 后）；
      用全局 pointermove + mousemove 双通道兑底：指针不在悬停行矩形内就清除悬停态 */
  useEffect(() => {
    if (hoverRow < 0) return;
    const onMove = (event: MouseEvent) => {
      const rect = hoverRowRef.current?.getBoundingClientRect();
      if (
        !rect ||
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        setHoverRow(-1);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mousemove", onMove);
    };
  }, [hoverRow]);

  /** 参数值上回车：聚焦下一行的参数名输入框（末行时即为自动追加的占位行） */
  const focusNextRowKey = (index: number) => {
    requestAnimationFrame(() => {
      const inputs = tableRef.current?.querySelectorAll<HTMLInputElement>(
        '.request-params-row input:not([type="checkbox"])',
      );
      inputs?.[(index + 1) * 2]?.focus();
    });
  };

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggleRow = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((_, i) => i)));
  };

  /** 删除若干行；删除后行号变化，直接清空选中 */
  const removeRows = (indexes: ReadonlySet<number>) => {
    onChange(items.filter((_, i) => !indexes.has(i)));
    setSelected(new Set());
  };

  /** 编辑第 index 行；编辑末尾占位行时自动追加为新条目 */
  const patchItem = (index: number, patch: Partial<FormRow>) => {
    if (index === items.length) {
      onChange([...items, { key: "", value: "", ...patch }]);
      return;
    }
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  /** 切换字段类型；首次切到 array 时用已填的单值种子多值列表 */
  const changeType = (index: number, type: FormFieldType) => {
    const item = items[index];
    const patch: Partial<FormRow> = { fieldType: type };
    if (type === "array" && !item?.values?.length) {
      patch.values = item?.value ? [item.value] : [""];
    }
    patchItem(index, patch);
  };

  /** 选择文件：写入文件绝对路径作为字段值 */
  const pickFile = async (index: number) => {
    const path = await openFileDialog({ multiple: false, directory: false });
    if (typeof path === "string") patchItem(index, { value: path });
  };

  return (
    <section className="request-params">
      <div className="request-params-header">
        <h4 className="request-params-title">{title}</h4>
        <div className="request-params-tools">
          {selected.size > 0 && (
            <button
              type="button"
              className="request-params-tool request-params-tool-danger"
              onClick={() => removeRows(selected)}
            >
              <Trash2 aria-hidden="true" />
              {t("editor.deleteSelected", { n: selected.size })}
            </button>
          )}
          {!typed && (
            <button
              type="button"
              className="request-params-tool"
              onClick={() => setBatchOpen(true)}
            >
              <SquarePen aria-hidden="true" />
              {t("editor.batchEdit")}
            </button>
          )}
        </div>
      </div>
      <div className="request-params-table" ref={tableRef}>
        <div className={`request-params-head${typed ? " request-params-typed" : ""}`}>
          <input
            type="checkbox"
            className="request-params-check"
            aria-label={t("editor.selectAll")}
            disabled={items.length === 0}
            checked={allSelected}
            onChange={toggleAll}
          />
          <span>{keyPlaceholder}</span>
          {typed && <span className="request-params-head-type">{t("editor.colType")}</span>}
          <span>{valuePlaceholder}</span>
          <span aria-hidden="true" />
        </div>
        {[...items, { key: "", value: "" }].map((item, index) => {
          const isPlaceholder = index === items.length;
          const rowType: FormFieldType = item.fieldType ?? "text";
          return (
            <div
              key={index}
              className={`request-params-row${typed ? " request-params-typed" : ""}${index === hoverRow ? " is-hover" : ""}`}
              onPointerEnter={(event) => {
                hoverRowRef.current = event.currentTarget;
                setHoverRow(index);
              }}
              onPointerLeave={() => setHoverRow(-1)}
            >
              {isPlaceholder ? (
                <span aria-hidden="true" />
              ) : (
                <input
                  type="checkbox"
                  className="request-params-check"
                  aria-label={t("editor.selectRow")}
                  checked={selected.has(index)}
                  onChange={() => toggleRow(index)}
                />
              )}
              <input
                placeholder={isPlaceholder ? keyPlaceholder : undefined}
                value={item.key}
                onChange={(event) => patchItem(index, { key: event.target.value })}
              />
              {typed && (
                <Select
                  value={rowType}
                  onValueChange={(value) => changeType(index, value as FormFieldType)}
                >
                  <SelectTrigger
                    size="sm"
                    className="request-field-type"
                    aria-label={t("editor.fieldTypeAria")}
                  >
                    <span>{rowType}</span>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {fieldTypes!.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {typed && rowType === "file" ? (
                <div className="request-file-cell">
                  <button
                    type="button"
                    className="request-file-btn"
                    title={item.value || undefined}
                    onClick={() => void pickFile(index)}
                  >
                    <FolderOpen aria-hidden="true" />
                    <span className={item.value ? undefined : "request-file-placeholder"}>
                      {item.value ? fileNameOf(item.value) : t("editor.chooseFile")}
                    </span>
                  </button>
                  {item.value && (
                    <button
                      type="button"
                      className="request-file-clear"
                      title={t("editor.clearFile")}
                      aria-label={t("editor.clearFile")}
                      onClick={() => patchItem(index, { value: "" })}
                    >
                      <X />
                    </button>
                  )}
                </div>
              ) : typed && rowType === "array" ? (
                <div className="request-array-cell">
                  {(item.values ?? []).map((value, valueIndex) => (
                    <div key={valueIndex} className="request-array-value">
                      <input
                        placeholder={t("editor.valueN", { n: valueIndex + 1 })}
                        value={value}
                        onChange={(event) =>
                          patchItem(index, {
                            values: item.values!.map((v, i) =>
                              i === valueIndex ? event.target.value : v,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="request-array-remove"
                        title={t("editor.deleteValue")}
                        aria-label={t("editor.deleteValue")}
                        onClick={() =>
                          patchItem(index, {
                            values: item.values!.filter((_, i) => i !== valueIndex),
                          })
                        }
                      >
                        <X />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="request-array-add"
                    onClick={() => patchItem(index, { values: [...(item.values ?? []), ""] })}
                  >
                    <Plus aria-hidden="true" />
                    {t("editor.addValue")}
                  </button>
                </div>
              ) : (
                <input
                  placeholder={isPlaceholder ? valuePlaceholder : undefined}
                  value={item.value}
                  onChange={(event) => patchItem(index, { value: event.target.value })}
                  onKeyDown={
                    typed
                      ? undefined
                      : (event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            focusNextRowKey(index);
                          }
                        }
                  }
                />
              )}
              {isPlaceholder ? (
                <span aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className="request-params-remove"
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                  onClick={() => removeRows(new Set([index]))}
                >
                  <Trash2 />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <BatchEditModal
        visible={batchOpen}
        items={items}
        keyPlaceholder={keyPlaceholder}
        valuePlaceholder={valuePlaceholder}
        onCancel={() => setBatchOpen(false)}
        onConfirm={(next) => {
          onChange(next);
          setSelected(new Set());
          setBatchOpen(false);
        }}
      />
    </section>
  );
}

/** 路径参数表格：参数名来自 URL 中的 {name} 占位符，只读；仅可编辑参数值 */
function PathParamTable({
  items,
  onChange,
}: {
  items: QueryParam[];
  onChange: (items: QueryParam[]) => void;
}) {
  return (
    <section className="request-params">
      <div className="request-params-header">
        <h4 className="request-params-title">{t("editor.pathParams")}</h4>
      </div>
      <div className="request-params-table">
        <div className="request-params-head request-path-row">
          <span>{t("editor.paramKey")}</span>
          <span>{t("editor.paramValue")}</span>
        </div>
        {items.map((item, index) => (
          <div key={item.key} className="request-params-row request-path-row">
            <input
              value={item.key}
              readOnly
              aria-label={t("editor.pathParamNameAria")}
              tabIndex={-1}
            />
            <input
              placeholder={t("editor.pathValuePlaceholder", { name: `{${item.key}}` })}
              value={item.value}
              onChange={(event) =>
                onChange(
                  items.map((it, i) => (i === index ? { ...it, value: event.target.value } : it)),
                )
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/** 只读表格：响应 Headers / Cookies 共用 */
function ResponseTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="request-response-body response-table-wrap">
      <table className="response-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 事件时刻（毫秒）→ HH:MM:SS */
function formatEventTime(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 最后一条 message 事件的下标；没有时返回 -1 */
function findLastMessageIndex(events: SseEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "message") return i;
  }
  return -1;
}

/** SSE 时间线左右分栏拖拽时的最小宽度 */
const SSE_PANE_MIN_WIDTH = 160;

/** SSE 时间线：左侧逐条事件列表，右侧选中事件详情（JSON 自动美化），中缝分隔线可拖拽调宽 */
function SseTimeline({
  events,
  selected,
  onSelect,
}: {
  events: SseEvent[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 左侧列表宽度（px）；null 表示未拖拽过，默认左右各占一半
  const [listWidth, setListWidth] = useState<number | null>(null);
  // 搜索关键词：按 data 内容忽略大小写过滤事件列表
  const [query, setQuery] = useState("");
  // 可见事件：保留原始下标，选中 / 详情仍按全量事件定位
  const visible = useMemo(() => {
    const rows = events.map((event, index) => ({ event, index }));
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(({ event }) => event.data.toLowerCase().includes(keyword));
  }, [events, query]);
  // 未手动选中时跟随最新：新事件到达自动滚到底部
  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length 作为触发器，新事件时滚到底部
  useEffect(() => {
    if (selected === null) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [events.length, selected]);
  // 详情展示选中项；未选中时取最后一条 message
  const activeIndex = selected ?? findLastMessageIndex(events);
  const active = activeIndex >= 0 ? events[activeIndex] : null;
  // data 为合法 JSON 时美化展示，否则原文展示
  const detailJson = useMemo(() => {
    if (!active || active.kind !== "message") return null;
    try {
      return JSON.stringify(JSON.parse(active.data), null, 2);
    } catch {
      return null;
    }
  }, [active]);

  /** 复制右侧展示的内容（JSON 美化后的文本，非 JSON 为原文） */
  const handleCopyDetail = async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(detailJson ?? active.data);
      toast.success(t("editor.copied"));
    } catch (err) {
      console.error("复制 SSE 事件内容失败", err);
      toast.error(t("editor.copyFailed"));
    }
  };

  /** 拖拽中缝分隔线调整左右宽度，两侧各保留最小宽度 */
  const startPaneResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftRef.current?.offsetWidth ?? 0;
    const total = rootRef.current?.clientWidth ?? 0;
    const max = Math.max(total - SSE_PANE_MIN_WIDTH, SSE_PANE_MIN_WIDTH);
    const onMove = (e: PointerEvent) => {
      const next = startWidth + (e.clientX - startX);
      setListWidth(Math.min(max, Math.max(SSE_PANE_MIN_WIDTH, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-sse-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("is-sse-resizing");
  };

  return (
    <div ref={rootRef} className="request-response-body response-sse">
      <div
        ref={leftRef}
        className="response-sse-left"
        style={listWidth !== null ? { flex: "none", width: listWidth } : undefined}
      >
        {/* 搜索栏：按事件内容过滤 */}
        <div className="response-sse-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            spellCheck={false}
            placeholder={t("editor.sseSearchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="response-sse-search-clear"
              title={t("common.clear")}
              aria-label={t("common.clear")}
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div ref={listRef} className="response-sse-list">
          {visible.map(({ event, index }) => (
            <button
              key={index}
              type="button"
              className={`response-sse-row${index === activeIndex ? " is-active" : ""}`}
              onClick={() => onSelect(index === selected ? null : index)}
            >
              {event.kind === "open" ? (
                <CircleCheck className="response-sse-icon is-open" aria-hidden="true" />
              ) : event.kind === "close" ? (
                <Unplug className="response-sse-icon is-close" aria-hidden="true" />
              ) : event.kind === "error" ? (
                <CircleAlert className="response-sse-icon is-error" aria-hidden="true" />
              ) : (
                <ArrowDown className="response-sse-icon" aria-hidden="true" />
              )}
              <span className="response-sse-data">
                {event.kind === "open"
                  ? t("editor.sseConnected", { url: event.data })
                  : event.kind === "close"
                    ? t("editor.sseDisconnected")
                    : event.data}
              </span>
              <span className="response-sse-time">{formatEventTime(event.timestampMs)}</span>
            </button>
          ))}
          {visible.length === 0 && <p className="response-sse-nomatch">{t("editor.sseNoMatch")}</p>}
        </div>
      </div>
      {/* 中缝拖拽手柄：骑在列表右边框上 */}
      <div className="response-sse-resizer" aria-hidden="true" onPointerDown={startPaneResize} />
      <div className="response-sse-detail">
        {active && (
          <button
            type="button"
            className="response-sse-copy"
            title={t("common.copy")}
            aria-label={t("common.copy")}
            onClick={() => void handleCopyDetail()}
          >
            <Copy aria-hidden="true" />
          </button>
        )}
        {active &&
          (detailJson !== null ? (
            <JsonViewer value={detailJson} />
          ) : (
            <pre className="response-sse-plain">{active.data}</pre>
          ))}
      </div>
    </div>
  );
}

/**
 * 解析响应头中的 Set-Cookie。
 * 后端将多个同名头以 ", " 合并，这里仅在逗号后紧跟 `key=` 时拆分，
 * 避免切断 Expires 属性里的日期逗号（如 "Wed, 21 Oct 2015"）。
 */
function parseSetCookies(headers: Record<string, string>): ResponseCookie[] {
  const raw = Object.entries(headers).find(([key]) => key.toLowerCase() === "set-cookie")?.[1];
  if (!raw) return [];
  return raw.split(/,(?=\s*[^\s;=,]+=)/).map((entry) => {
    const [pair = "", ...attrs] = entry.trim().split(";");
    const eq = pair.indexOf("=");
    return {
      name: eq === -1 ? pair : pair.slice(0, eq),
      value: eq === -1 ? "" : pair.slice(eq + 1),
      attributes: attrs.map((attr) => attr.trim()).join("; "),
    };
  });
}

/** JSON 响应体格式化；非 JSON 或解析失败返回 null */
function formatJsonBody(response: HttpResponseData): string | null {
  const contentType = response.headers["content-type"] ?? "";
  if (!contentType.includes("json")) return null;
  try {
    return JSON.stringify(JSON.parse(response.body), null, 2);
  } catch {
    return null; // 非法 JSON 时原样展示
  }
}

/** 字节数转可读大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 清理右键选中的文本作为变量值：去首尾空白、尾逗号与包裹引号 */
function cleanSelection(text: string): string {
  let value = text.trim();
  if (value.endsWith(",")) value = value.slice(0, -1).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  return value;
}

/** 常见响应类型对应的文件扩展名，推断保存文件名用 */
const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/x-icon": ".ico",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/gzip": ".gz",
};

/** 推断保存响应的默认文件名：Content-Disposition > URL 末段 > 按类型补扩展名 */
function suggestFileName(url: string, headers: Record<string, string>): string {
  const disposition =
    Object.entries(headers).find(([key]) => key.toLowerCase() === "content-disposition")?.[1] ?? "";
  const fromHeader = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition)?.[1];
  if (fromHeader) {
    try {
      return decodeURIComponent(fromHeader.trim());
    } catch {
      return fromHeader.trim();
    }
  }
  const segment = url.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
  if (segment.includes(".")) return segment;
  const contentType = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  return (segment || "response") + (MIME_EXT[contentType] ?? "");
}

export default RequestEditor;
