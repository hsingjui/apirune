import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { tags } from "@lezer/highlight";
import CodeMirror, {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type Panel,
  RangeSetBuilder,
  runScopeHandlers,
  ViewPlugin,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { Braces, CircleAlert, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePersistentState } from "../hooks/usePersistentState";
import { t } from "../i18n";
import { findJsonComments, parseJsonWithComments } from "../utils/jsonc";

/** JSON token 配色：引用主题令牌（global.css 的 --json-*），随浅深主题自动切换 */
const paperHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.propertyName, color: "var(--json-key)" }, // key：贴合主题强调色
    { tag: tags.string, color: "var(--json-string)" }, // 字符串：苔绿
    { tag: tags.number, color: "var(--json-number)" }, // 数字：黛蓝
    { tag: tags.bool, color: "var(--json-bool)" }, // 布尔：青紫
    { tag: tags.null, color: "var(--json-null)", fontStyle: "italic" }, // null：三级墨色
    { tag: tags.invalid, color: "var(--json-invalid)" },
  ]),
);

const commentMark = Decoration.mark({ class: "cm-json-comment" });

/** 从文档开头扫到视口末尾（块注释可能始于视口上方，状态需从头推导） */
function buildCommentDecorations(view: EditorView): DecorationSet {
  const scanEnd = view.visibleRanges.reduce((end, range) => Math.max(end, range.to), 0);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of findJsonComments(view.state.doc.sliceString(0, scanEnd))) {
    builder.add(from, to, commentMark);
  }
  return builder.finish();
}

/** JSONC 注释高亮：lezer JSON 语法不含注释，扫描注释范围套用主题令牌色 */
const jsonCommentHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildCommentDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildCommentDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/** 携带展开替换行方法的面板根节点，供 ⌘R 呼起 */
type SearchPanelDom = HTMLDivElement & { expandReplace?: () => void };

/** VS Code 风格的浮动查找替换面板（只读视图不渲染替换行） */
function createSearchPanel(view: EditorView): Panel {
  const readOnly = view.state.readOnly;
  const initial = getSearchQuery(view.state);

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text) node.textContent = text;
    if (node instanceof HTMLButtonElement) node.type = "button";
    return node;
  };

  const dom = make("div", "cm-vs-search") as SearchPanelDom;
  const toggle = make("button", "cm-vs-search-toggle", "\u25b8");
  toggle.title = t("json.toggleReplace");
  const main = make("div", "cm-vs-search-main");
  const row1 = make("div", "cm-vs-search-row");
  const row2 = make("div", "cm-vs-search-row");

  // 查找输入框 + 内联选项开关（Aa / ab / .*）
  const inputWrap = make("div", "cm-vs-search-input-wrap");
  const input = make("input", "cm-vs-search-input");
  input.placeholder = t("json.find");
  input.value = initial.search;
  const optCase = make("button", "cm-vs-search-opt", "Aa");
  optCase.title = t("json.matchCase");
  const optWord = make("button", "cm-vs-search-opt", "ab");
  optWord.title = t("json.wholeWord");
  const optRe = make("button", "cm-vs-search-opt", ".*");
  optRe.title = t("json.regexp");
  optCase.classList.toggle("is-on", initial.caseSensitive);
  optWord.classList.toggle("is-on", initial.wholeWord);
  optRe.classList.toggle("is-on", initial.regexp);
  inputWrap.append(input, optCase, optWord, optRe);

  const count = make("span", "cm-vs-search-count");
  const prev = make("button", "cm-vs-search-btn", "\u2191");
  prev.title = t("json.prev");
  const next = make("button", "cm-vs-search-btn", "\u2193");
  next.title = t("json.next");
  const close = make("button", "cm-vs-search-btn", "\u2715");
  close.title = t("json.close");
  row1.append(inputWrap, count, prev, next, close);

  // 替换行（默认折叠）
  const replaceWrap = make("div", "cm-vs-search-input-wrap");
  const replaceInput = make("input", "cm-vs-search-input");
  replaceInput.placeholder = t("json.replace");
  replaceInput.value = initial.replace;
  replaceWrap.append(replaceInput);
  const replaceOne = make("button", "cm-vs-search-text-btn", t("json.replace"));
  const replaceEvery = make("button", "cm-vs-search-text-btn", t("json.replaceAll"));
  row2.append(replaceWrap, replaceOne, replaceEvery);

  main.append(row1);
  if (!readOnly) {
    main.append(row2);
    dom.append(toggle);
  }
  dom.append(main);

  const setExpanded = (value: boolean) => {
    toggle.textContent = value ? "\u25be" : "\u25b8";
    row2.style.display = value ? "" : "none";
  };
  setExpanded(false);
  toggle.onclick = () => setExpanded(row2.style.display === "none");
  dom.expandReplace = () => {
    setExpanded(true);
    replaceInput.focus();
    replaceInput.select();
  };

  /** 匹配计数：当前项/总数，上限 999 防止大文档卡顿 */
  const updateCount = () => {
    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) {
      count.textContent = "";
      return;
    }
    const sel = view.state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(view.state);
    let item = cursor.next();
    while (!item.done && total < 999) {
      total += 1;
      if (item.value.from === sel.from && item.value.to === sel.to) current = total;
      item = cursor.next();
    }
    const suffix = item.done ? "" : "+";
    count.textContent =
      total === 0
        ? t("json.noResults")
        : current
          ? `${current}/${total}${suffix}`
          : t("json.total", { total, suffix });
  };

  const commit = () => {
    const query = new SearchQuery({
      search: input.value,
      caseSensitive: optCase.classList.contains("is-on"),
      wholeWord: optWord.classList.contains("is-on"),
      regexp: optRe.classList.contains("is-on"),
      replace: replaceInput.value,
    });
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
    updateCount();
  };

  input.addEventListener("input", commit);
  replaceInput.addEventListener("input", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    (event.shiftKey ? findPrevious : findNext)(view);
  });
  replaceInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    replaceNext(view);
  });
  for (const opt of [optCase, optWord, optRe]) {
    opt.addEventListener("click", () => {
      opt.classList.toggle("is-on");
      commit();
    });
  }
  prev.onclick = () => findPrevious(view);
  next.onclick = () => findNext(view);
  close.onclick = () => closeSearchPanel(view);
  replaceOne.onclick = () => replaceNext(view);
  replaceEvery.onclick = () => replaceAll(view);
  // 把面板内的快捷键（Esc 关闭等）交给 CodeMirror 的 search-panel 作用域处理
  dom.addEventListener("keydown", (event) => {
    if (runScopeHandlers(view, event, "search-panel")) event.preventDefault();
  });

  updateCount();
  return {
    dom,
    top: true,
    mount: () => {
      input.focus();
      input.select();
    },
    update: (update: ViewUpdate) => {
      if (update.docChanged || update.selectionSet) updateCount();
    },
  };
}

/** ⌘R 打开搜索面板并展开替换行（只读视图无替换行，退化为查找） */
function openReplacePanel(view: EditorView): boolean {
  openSearchPanel(view);
  view.dom.querySelector<SearchPanelDom>(".cm-vs-search")?.expandReplace?.();
  return true;
}

/** ⌘⇧C 复制全部内容 */
function copyWholeDoc(view: EditorView): boolean {
  void navigator.clipboard.writeText(view.state.doc.toString()).then(
    () => toast.success(t("editor.copied")),
    () => toast.error(t("editor.copyFailed")),
  );
  return true;
}

/** 自动换行开关：编辑器与查看器实例间同步，并持久化到 localStorage */
const wrapListeners = new Set<(wrap: boolean) => void>();

function useJsonWrap(): [boolean, () => void] {
  const [wrap, setWrap] = usePersistentState("apirune:json-wrap", true);
  useEffect(() => {
    wrapListeners.add(setWrap);
    return () => {
      wrapListeners.delete(setWrap);
    };
  }, [setWrap]);
  const toggleWrap = useCallback(() => {
    setWrap((prev) => {
      const next = !prev;
      for (const listener of wrapListeners) listener(next);
      return next;
    });
  }, [setWrap]);
  return [wrap, toggleWrap];
}

/** 自动换行切换按钮：开启时高亮，切换长行是软换行还是横向滚动 */
function JsonWrapButton({ wrap, onToggle }: { wrap: boolean; onToggle: () => void }) {
  const label = wrap ? t("json.toggleWrapOff") : t("json.toggleWrapOn");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`json-wrap${wrap ? " is-on" : ""}`}
          aria-label={label}
          aria-pressed={wrap}
          onClick={onToggle}
        >
          {/* 轻量回绕图标：两行文本 + 末行回收箭头，自绘以控制视觉大小与线宽 */}
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 3.5h10" />
            <path d="M2 7h9.5a1.5 1.5 0 0 1 0 3H6.4" />
            <path d="M8.1 8.7 6.4 10l1.7 1.3" />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** 共用扩展：JSON 语言 + 暖纸配色 + 查找替换（⌘F / ⌘R） + 快捷复制（⌘⇧C）；自动换行按开关挂载 */
const baseExtensions = [
  json(),
  paperHighlight,
  jsonCommentHighlight,
  search({ top: true, createPanel: createSearchPanel }),
  keymap.of([
    { key: "Mod-r", run: openReplacePanel, preventDefault: true },
    { key: "Mod-Shift-c", run: copyWholeDoc, preventDefault: true },
  ]),
];

/** 右上角浮动复制按钮：一键复制全部 JSON */
function JsonCopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("editor.copied")),
      () => toast.error(t("editor.copyFailed")),
    );
  };
  const label = t("common.copy");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="json-copy"
          aria-label={label}
          disabled={!text}
          onClick={handleCopy}
        >
          <Copy aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** JSON 属性名右键菜单所需的坐标与对应值。 */
export interface JsonPropertyContextMenu {
  x: number;
  y: number;
  value: string;
}

/** 读取属性名对应的 JSON 值；对象与数组保留 JSON，字符串取原始文本。 */
function getPropertyValue(view: EditorView, event: MouseEvent): string | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;

  let node = syntaxTree(view.state).resolveInner(pos);
  while (node.parent && node.name !== "Property") node = node.parent;
  if (node.name !== "Property") return null;

  const key = node.getChild("PropertyName");
  if (!key || pos < key.from || pos > key.to) return null;

  try {
    const property = view.state.sliceDoc(node.from, node.to);
    const parsed = parseJsonWithComments(`{${property}}`) as Record<string, unknown>;
    const value = Object.values(parsed)[0];
    return typeof value === "string" ? value : (JSON.stringify(value) ?? null);
  } catch {
    return null;
  }
}

/** 属性名右键：有菜单回调时交由外层展示操作项，否则直接复制对应值。 */
function propertyValueContextMenuExtension(
  onPropertyContextMenu?: (menu: JsonPropertyContextMenu) => void,
) {
  return EditorView.domEventHandlers({
    contextmenu: (event, view) => {
      const value = getPropertyValue(view, event);
      if (value === null) return false;

      event.preventDefault();
      event.stopPropagation();
      if (onPropertyContextMenu) {
        onPropertyContextMenu({ x: event.clientX, y: event.clientY, value });
      } else {
        void navigator.clipboard.writeText(value).then(
          () => toast.success(t("editor.copied")),
          () => toast.error(t("editor.copyFailed")),
        );
      }
      return true;
    },
  });
}

const propertyValueCopyExtension = propertyValueContextMenuExtension();

/**
 * 多行文本粘贴进 JSON 字符串时自动转义合并成单行，避免破坏 JSON 结构：
 * 1. 光标在字符串内部 → 转义内容（换行变 \\n，引号、反斜杠一并转义），不补引号；
 * 2. 光标在 `"key":` 之后的值起始处 → 补引号并转义；
 * 3. 恰好选中整个字符串值（含引号）→ 整体替换为转义后的新字符串。
 * 单行文本走默认粘贴，行为不变。
 */
const pasteEscapeExtension = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData("text/plain");
    if (!text || !/[\r\n]/.test(text)) return false;

    const range = view.state.selection.main;
    const node = syntaxTree(view.state).resolveInner(range.from, 0);
    let insert: string | null = null;

    if (range.empty) {
      if (node.name === "String" && range.head > node.from && range.head < node.to) {
        /* 字符串内部：仅转义，不补引号 */
        insert = JSON.stringify(text).slice(1, -1);
      } else {
        /* `"key":` 后等待值的位置：补引号 */
        const before = view.state.doc.sliceString(Math.max(0, range.head - 200), range.head);
        if (/:\s*$/.test(before)) insert = JSON.stringify(text);
      }
    } else if (node.name === "String" && node.from === range.from && node.to === range.to) {
      insert = JSON.stringify(text);
    }

    if (!insert) return false;
    event.preventDefault();
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      scrollIntoView: true,
    });
    return true;
  },
});

/** 编辑器额外扩展：JSONC 语法检查（错误波浪线 + 行号槽标记） */
const editorExtensions = [
  ...baseExtensions,
  linter(
    (view) => {
      try {
        parseJsonWithComments(view.state.doc.toString());
        return [];
      } catch (error) {
        return [
          {
            from: 0,
            to: 0,
            message: error instanceof Error ? error.message : String(error),
            severity: "error" as const,
          },
        ];
      }
    },
    { delay: 250 },
  ),
  lintGutter(),
  propertyValueCopyExtension,
  pasteEscapeExtension,
];

/** 查看器额外扩展：只读内容不可编辑时默认不可聚焦，补上 tabindex 让 ⌘F 可用 */
const viewerExtensions = [...baseExtensions, EditorView.contentAttributes.of({ tabindex: "0" })];

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 提供时在编辑器内展示格式化按钮 */
  onFormat?: () => void;
}

/** 带语法高亮与错误提示的 JSON 编辑器（请求体用） */
export function JsonEditor({ value, onChange, placeholder, onFormat }: JsonEditorProps) {
  /** 语法错误信息；空内容或合法 JSON 为 null */
  const error = useMemo(() => {
    if (!value.trim()) return null;
    try {
      parseJsonWithComments(value);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [value]);
  const [wrap, toggleWrap] = useJsonWrap();
  const extensions = useMemo(
    () => (wrap ? [...editorExtensions, EditorView.lineWrapping] : editorExtensions),
    [wrap],
  );

  return (
    <div className={`json-editor${error ? " json-editor-invalid" : ""}`}>
      <CodeMirror
        className="json-editor-cm"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        theme="none"
        extensions={extensions}
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
      {onFormat && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="json-format"
              aria-label={t("editor.format")}
              onClick={onFormat}
            >
              <Braces aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("editor.format")}</TooltipContent>
        </Tooltip>
      )}
      <JsonWrapButton wrap={wrap} onToggle={toggleWrap} />
      <JsonCopyButton text={value} />
      {error && (
        <div className="json-editor-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/** 只读 JSON 查看器（响应体用）：带行号、折叠与右上角复制按钮 */
export function JsonViewer({
  value,
  onPropertyContextMenu,
}: {
  value: string;
  onPropertyContextMenu?: (menu: JsonPropertyContextMenu) => void;
}) {
  const [wrap, toggleWrap] = useJsonWrap();
  const extensions = useMemo(
    () => [
      ...viewerExtensions,
      onPropertyContextMenu
        ? propertyValueContextMenuExtension(onPropertyContextMenu)
        : propertyValueCopyExtension,
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [onPropertyContextMenu, wrap],
  );

  return (
    <div className="json-viewer-wrap">
      <CodeMirror
        className="json-viewer"
        value={value}
        readOnly
        editable={false}
        theme="none"
        extensions={extensions}
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
      <JsonWrapButton wrap={wrap} onToggle={toggleWrap} />
      <JsonCopyButton text={value} />
    </div>
  );
}
