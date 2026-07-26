import { json, jsonParseLinter } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
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
  EditorView,
  keymap,
  type Panel,
  runScopeHandlers,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { CircleAlert } from "lucide-react";
import { useMemo } from "react";
import { t } from "../i18n";

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

/** 共用扩展：JSON 语言 + 自动换行 + 暖纸配色 + 查找替换（⌘F / ⌘R） */
const baseExtensions = [
  json(),
  EditorView.lineWrapping,
  paperHighlight,
  search({ top: true, createPanel: createSearchPanel }),
  keymap.of([{ key: "Mod-r", run: openReplacePanel, preventDefault: true }]),
];

/** 编辑器额外扩展：JSON 语法检查（错误波浪线 + 行号槽标记） */
const editorExtensions = [
  ...baseExtensions,
  linter(jsonParseLinter(), { delay: 250 }),
  lintGutter(),
];

/** 查看器额外扩展：只读内容不可编辑时默认不可聚焦，补上 tabindex 让 ⌘F 可用 */
const viewerExtensions = [...baseExtensions, EditorView.contentAttributes.of({ tabindex: "0" })];

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** 带语法高亮与错误提示的 JSON 编辑器（请求体用） */
export function JsonEditor({ value, onChange, placeholder }: JsonEditorProps) {
  /** 语法错误信息；空内容或合法 JSON 为 null */
  const error = useMemo(() => {
    if (!value.trim()) return null;
    try {
      JSON.parse(value);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [value]);

  return (
    <div className={`json-editor${error ? " json-editor-invalid" : ""}`}>
      <CodeMirror
        className="json-editor-cm"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        theme="none"
        extensions={editorExtensions}
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
      {error && (
        <div className="json-editor-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/** 只读 JSON 查看器（响应体用）：带行号与折叠 */
export function JsonViewer({ value }: { value: string }) {
  return (
    <CodeMirror
      className="json-viewer"
      value={value}
      readOnly
      editable={false}
      theme="none"
      extensions={viewerExtensions}
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}
