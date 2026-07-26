/** 生成代码片段的轻量语法高亮：无第三方依赖，仅覆盖弹窗展示需求 */

export type HighlightLang = "shell" | "js" | "python" | "java" | "go" | "c";

/** 高亮 token 类型；undefined 表示普通文本 */
export type TokenType = "keyword" | "string" | "number" | "comment" | "flag";

export interface Token {
  text: string;
  type?: TokenType;
}

/** 各语言的关键字（含少量常用内建名，够用即可） */
const KEYWORDS: Record<HighlightLang, Set<string>> = {
  shell: new Set(["curl", "http", "wget"]),
  js: new Set([
    "const",
    "let",
    "var",
    "await",
    "async",
    "function",
    "new",
    "return",
    "if",
    "else",
    "for",
    "of",
    "true",
    "false",
    "null",
    "require",
    "throw",
  ]),
  python: new Set([
    "import",
    "from",
    "def",
    "return",
    "for",
    "in",
    "with",
    "as",
    "open",
    "print",
    "True",
    "False",
    "None",
  ]),
  java: new Set([
    "public",
    "static",
    "void",
    "class",
    "new",
    "import",
    "return",
    "final",
    "try",
    "catch",
    "null",
    "true",
    "false",
    "String",
  ]),
  go: new Set([
    "package",
    "import",
    "func",
    "defer",
    "return",
    "if",
    "nil",
    "var",
    "range",
    "true",
    "false",
  ]),
  c: new Set(["include", "int", "void", "const", "struct", "char", "return", "if"]),
};

/** 使用 # 行注释的语言；其余语言用 // */
const HASH_COMMENT_LANGS: ReadonlySet<HighlightLang> = new Set(["shell", "python"]);

/** 对整段代码做词法扫描（字符串可跨行，如 curl 的多行 JSON 体） */
export function tokenize(code: string, lang: HighlightLang): Token[] {
  const tokens: Token[] = [];
  const keywords = KEYWORDS[lang];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    // 注释：shell / python 用 #，其余语言用 //
    const isHash = HASH_COMMENT_LANGS.has(lang);
    if ((isHash && ch === "#") || (!isHash && ch === "/" && code[i + 1] === "/")) {
      let end = code.indexOf("\n", i);
      if (end === -1) end = code.length;
      tokens.push({ text: code.slice(i, end), type: "comment" });
      i = end;
      continue;
    }
    // 字符串：单双引号，支持反斜杠转义，允许跨行
    if (ch === "'" || ch === '"') {
      let end = i + 1;
      while (end < code.length) {
        if (code[end] === "\\") {
          end += 2;
          continue;
        }
        if (code[end] === ch) {
          end += 1;
          break;
        }
        end += 1;
      }
      tokens.push({ text: code.slice(i, end), type: "string" });
      i = end;
      continue;
    }
    // shell 命令行选项：-X / --data-urlencode 等
    if (lang === "shell" && ch === "-" && (i === 0 || /\s/.test(code[i - 1]))) {
      let end = i;
      while (end < code.length && /[-\w]/.test(code[end])) end += 1;
      tokens.push({ text: code.slice(i, end), type: "flag" });
      i = end;
      continue;
    }
    // 标识符 / 关键字
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i;
      while (end < code.length && /[\w$]/.test(code[end])) end += 1;
      const word = code.slice(i, end);
      tokens.push({ text: word, type: keywords.has(word) ? "keyword" : undefined });
      i = end;
      continue;
    }
    // 数字
    if (/\d/.test(ch)) {
      let end = i;
      while (end < code.length && /[\d.]/.test(code[end])) end += 1;
      tokens.push({ text: code.slice(i, end), type: "number" });
      i = end;
      continue;
    }
    tokens.push({ text: ch });
    i += 1;
  }
  return tokens;
}

/** 将 token 流按换行拆成行，便于带行号渲染 */
export function tokenizeLines(code: string, lang: HighlightLang): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(code, lang)) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, type: token.type });
    });
  }
  return lines;
}
