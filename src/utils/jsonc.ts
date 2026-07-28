/** 移除 JSONC 的行注释与块注释，同时保留字符串内容与换行位置。 */
export function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        result += char;
      } else {
        result += " ";
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        inBlockComment = false;
      } else {
        result += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
    } else if (char === "/" && next === "/") {
      result += "  ";
      index += 1;
      inLineComment = true;
    } else if (char === "/" && next === "*") {
      result += "  ";
      index += 1;
      inBlockComment = true;
    } else {
      result += char;
    }
  }

  if (inBlockComment) throw new SyntaxError("Unterminated block comment");
  return result;
}

/** 解析可包含注释的 JSON 文本。 */
export function parseJsonWithComments(source: string): unknown {
  return JSON.parse(stripJsonComments(source));
}

/** 收集 JSONC 文本中全部行注释与块注释的范围（不含换行符），供编辑器高亮使用。 */
export function findJsonComments(source: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "/" && next === "/") {
      let end = index + 2;
      while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
      ranges.push({ from: index, to: end });
      index = end - 1;
    } else if (char === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      ranges.push({ from: index, to: end });
      index = end - 1;
    }
  }

  return ranges;
}
