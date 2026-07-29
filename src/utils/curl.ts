import { t } from "../i18n";
import type { BodyType, FormField, HttpMethod, KeyValueItem } from "../types/request";
import type { ImportUrlRule } from "../types/environment";

/**
 * 导入后按用户配置的规则改写 URL：按顺序取第一条命中的规则。
 * 文本规则匹配前缀；正则规则匹配整个 URL。非法正则直接跳过。
 */
export function applyImportUrlRules(url: string, rules: ImportUrlRule[]): string {
  for (const rule of rules) {
    const match = rule.match.trim();
    if (!match) continue;
    if (rule.regex) {
      try {
        const pattern = new RegExp(match);
        if (pattern.test(url)) return url.replace(pattern, rule.replace);
      } catch {
        // 非法正则：视为不命中，不阻断导入
      }
    } else if (url.startsWith(match)) {
      return rule.replace + url.slice(match.length);
    }
  }
  return url;
}

/** curl 命令解析结果，可直接填充快捷请求编辑器 */
export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  bodyType: BodyType;
  /** 请求体原文；form 类为 FormField[] 的 JSON 串 */
  body: string;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 导入时不保留由 HTTP 客户端或运行时管理的连接级请求头 */
const SKIPPED_IMPORT_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 带值但与请求内容无关的选项，解析时连同其值一起跳过 */
const IGNORED_VALUE_OPTIONS = new Set([
  "-o",
  "--output",
  "-m",
  "--max-time",
  "--connect-timeout",
  "--retry",
  "-x",
  "--proxy",
  "--cacert",
  "--cert",
  "--key",
  "--limit-rate",
  "-c",
  "--cookie-jar",
]);

/** $'...' 内的 ANSI-C 转义映射 */
const ANSI_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

/**
 * 将浏览器「Copy as cURL (cmd)」的 CMD 转义还原为实际参数。
 * 仅在检测到 CMD 特有的 ^ 转义或续行时处理，避免影响 Bash 中的普通 ^ 字符。
 */
function normalizeCmdEscapes(input: string): string {
  if (!/\^(?:\r?\n|["&|<>()%^])/.test(input)) return input;
  return input.replace(/\^\r?\n[ \t]*/g, " ").replace(/\^([^\r\n])/g, "$1");
}

/** 按 shell 规则切分命令行：支持 Bash 引号/转义/续行及 Windows CMD 的 ^ 转义 */
function tokenize(input: string): string[] {
  const text = normalizeCmdEscapes(input).replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "$" && text[i + 1] === "'") {
      inToken = true;
      i += 2;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === "\\" && text[i + 1] in ANSI_ESCAPES) {
          current += ANSI_ESCAPES[text[i + 1]];
          i += 2;
        } else {
          current += text[i++];
        }
      }
      i += 1;
    } else if (ch === "'") {
      inToken = true;
      i += 1;
      while (i < text.length && text[i] !== "'") current += text[i++];
      i += 1;
    } else if (ch === '"') {
      inToken = true;
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && '"\\$`'.includes(text[i + 1] ?? "")) {
          current += text[i + 1];
          i += 2;
        } else {
          current += text[i++];
        }
      }
      i += 1;
    } else if (ch === "\\") {
      inToken = true;
      current += text[i + 1] ?? "";
      i += 2;
    } else if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      i += 1;
    } else {
      inToken = true;
      current += ch;
      i += 1;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

/** 把 "Key: Value" 形式的请求头拆成键值对 */
function splitHeader(raw: string): KeyValueItem | null {
  const index = raw.indexOf(":");
  if (index <= 0) return null;
  return { key: raw.slice(0, index).trim(), value: raw.slice(index + 1).trim(), enabled: true };
}

/** 把 a=b&c=d 形式的 query/表单串拆成键值对 */
function splitQueryString(raw: string): KeyValueItem[] {
  return raw
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf("=");
      const key = index >= 0 ? pair.slice(0, index) : pair;
      const value = index >= 0 ? pair.slice(index + 1) : "";
      const decode = (text: string) => {
        try {
          return decodeURIComponent(text.replace(/\+/g, "%20"));
        } catch {
          return text;
        }
      };
      return { key: decode(key), value: decode(value), enabled: true };
    });
}

/** 查找请求头的值（忽略大小写） */
function findHeader(headers: KeyValueItem[], name: string): string {
  return headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * 解析导入内容，自动识别格式：
 * - Bash curl（浏览器「Copy as cURL (bash)」）
 * - Windows CMD curl（浏览器「Copy as cURL (cmd)」）
 * - PowerShell Invoke-WebRequest / Invoke-RestMethod（浏览器「Copy as PowerShell」）
 * - 浏览器复制的原始 HTTP 请求头
 */
export function parseImportCommand(command: string): ParsedCurl {
  const trimmed = command.trim();
  if (/^[A-Z]+\s+\S+\s+HTTP\/\d(?:\.\d)?$/i.test(trimmed.split(/\r?\n/, 1)[0] ?? "")) {
    return parseHttpRequest(trimmed);
  }
  if (/^curl\s/i.test(trimmed) || trimmed.toLowerCase() === "curl") {
    return parseCurl(trimmed);
  }
  if (/Invoke-WebRequest|Invoke-RestMethod/i.test(trimmed)) {
    return parsePowerShell(trimmed);
  }
  throw new Error(t("curl.unrecognized"));
}

/**
 * 解析浏览器「复制请求标头」得到的 HTTP 请求文本。
 * 相对请求路径按 Referer 的协议与 Host 还原为完整 URL。
 */
export function parseHttpRequest(request: string): ParsedCurl {
  const [head, bodyRaw = ""] = request.split(/\r?\n\r?\n/, 2);
  const [requestLine, ...headerLines] = head.split(/\r?\n/);
  const match = requestLine?.match(/^([A-Z]+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/i);
  if (!match) throw new Error(t("curl.invalidHttpRequest"));

  const method = match[1].toUpperCase();
  if (!METHODS.includes(method as HttpMethod)) {
    throw new Error(t("curl.unsupportedMethod", { method }));
  }

  const allHeaders = headerLines.flatMap((line) => {
    const header = splitHeader(line);
    return header ? [header] : [];
  });
  const host = findHeader(allHeaders, "host");
  const target = match[2];
  let url = target;
  if (!/^https?:\/\//i.test(url)) {
    if (!host || !target.startsWith("/")) throw new Error(t("curl.httpRequestNoUrl"));
    let protocol = "http:";
    try {
      const referer = new URL(findHeader(allHeaders, "referer"));
      if (referer.protocol === "http:" || referer.protocol === "https:") protocol = referer.protocol;
    } catch {
      // 没有可用 Referer 时，使用 HTTP 作为浏览器原始请求的默认协议。
    }
    url = `${protocol}//${host}${target}`;
  }

  const headers = allHeaders.filter((header) => !SKIPPED_IMPORT_HEADERS.has(header.key.toLowerCase()));
  const params: KeyValueItem[] = [];
  const queryIndex = url.indexOf("?");
  if (queryIndex >= 0) {
    params.push(...splitQueryString(url.slice(queryIndex + 1)));
    url = url.slice(0, queryIndex);
  }

  let bodyType: BodyType = "none";
  let body = "";
  if (bodyRaw) {
    const contentType = findHeader(headers, "content-type").toLowerCase();
    if (contentType.includes("json") || /^\s*[[{]/.test(bodyRaw)) {
      bodyType = "json";
      body = bodyRaw;
    } else if (contentType.includes("x-www-form-urlencoded")) {
      bodyType = "x-www-form-urlencoded";
      body = JSON.stringify(splitQueryString(bodyRaw));
    } else {
      bodyType = "raw";
      body = bodyRaw;
    }
  }

  return { method: method as HttpMethod, url, params, headers, bodyType, body };
}

/**
 * 解析 curl 命令为请求配置。
 * 支持常见选项：-X/-H/-d(--data 系列)/-F/-u/-b/-A/-e/-G/--url 等，
 * 兼容浏览器「Copy as cURL」的 Bash 与 Windows CMD 输出。解析失败时抛出中文错误信息。
 */
export function parseCurl(command: string): ParsedCurl {
  const tokens = tokenize(command.trim());
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error(t("curl.mustStartWithCurl"));
  }

  let method: HttpMethod | null = null;
  let url = "";
  const headers: KeyValueItem[] = [];
  const dataParts: string[] = [];
  const formItems: FormField[] = [];
  let useGet = false;
  let hasUrlencodeFlag = false;

  const next = (i: number, option: string): string => {
    const value = tokens[i + 1];
    if (value === undefined) throw new Error(t("curl.missingValue", { option }));
    return value;
  };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token) {
      case "-X":
      case "--request": {
        const raw = next(i++, token).toUpperCase();
        if (!METHODS.includes(raw as HttpMethod))
          throw new Error(t("curl.unsupportedMethod", { method: raw }));
        method = raw as HttpMethod;
        break;
      }
      case "-H":
      case "--header": {
        const header = splitHeader(next(i++, token));
        if (header) headers.push(header);
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        dataParts.push(next(i++, token));
        break;
      case "--data-urlencode":
        hasUrlencodeFlag = true;
        dataParts.push(next(i++, token));
        break;
      case "-F":
      case "--form": {
        const raw = next(i++, token);
        const eq = raw.indexOf("=");
        if (eq > 0) {
          const key = raw.slice(0, eq);
          const value = raw.slice(eq + 1);
          // curl 语义：@ 前缀表示上传文件（路径可能带 ;type=... 附加参数）
          if (value.startsWith("@")) {
            formItems.push({
              key,
              value: value.slice(1).split(";")[0],
              enabled: true,
              fieldType: "file",
            });
          } else {
            formItems.push({ key, value, enabled: true });
          }
        }
        break;
      }
      case "-u":
      case "--user": {
        const credentials = next(i++, token);
        try {
          headers.push({
            key: "Authorization",
            value: `Basic ${btoa(credentials)}`,
            enabled: true,
          });
        } catch {
          throw new Error(t("curl.basicAuthEncode"));
        }
        break;
      }
      case "-b":
      case "--cookie":
        headers.push({ key: "Cookie", value: next(i++, token), enabled: true });
        break;
      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: next(i++, token), enabled: true });
        break;
      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: next(i++, token), enabled: true });
        break;
      case "--url":
        url = next(i++, token);
        break;
      case "-G":
      case "--get":
        useGet = true;
        break;
      default:
        if (token.startsWith("-X") && token.length > 2) {
          // 兼容 -XPOST 连写形式
          const raw = token.slice(2).toUpperCase();
          if (!METHODS.includes(raw as HttpMethod))
            throw new Error(t("curl.unsupportedMethod", { method: raw }));
          method = raw as HttpMethod;
        } else if (IGNORED_VALUE_OPTIONS.has(token)) {
          i += 1;
        } else if (token.startsWith("-")) {
          // 其余选项（--compressed、-s、-L 等）不影响请求内容，忽略
        } else if (!url) {
          url = token;
        }
        break;
    }
  }

  if (!url) throw new Error(t("curl.noUrl"));
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // 拆出 URL 中的 query 参数
  const params: KeyValueItem[] = [];
  const queryIndex = url.indexOf("?");
  if (queryIndex >= 0) {
    params.push(...splitQueryString(url.slice(queryIndex + 1)));
    url = url.slice(0, queryIndex);
  }

  // -G 时 data 追加为 query 参数
  if (useGet && dataParts.length > 0) {
    params.push(...splitQueryString(dataParts.join("&")));
    dataParts.length = 0;
  }

  // 推断请求体类型
  let bodyType: BodyType = "none";
  let body = "";
  const contentType = findHeader(headers, "content-type").toLowerCase();
  if (formItems.length > 0) {
    bodyType = "form-data";
    body = JSON.stringify(formItems);
  } else if (dataParts.length > 0) {
    const rawBody = dataParts.join("&");
    if (contentType.includes("json") || /^\s*[[{]/.test(rawBody)) {
      bodyType = "json";
      body = rawBody;
    } else if (hasUrlencodeFlag || contentType.includes("x-www-form-urlencoded") || !contentType) {
      bodyType = "x-www-form-urlencoded";
      body = JSON.stringify(splitQueryString(rawBody));
    } else {
      bodyType = "raw";
      body = rawBody;
    }
  }

  return {
    method: method ?? (bodyType === "none" ? "GET" : "POST"),
    url,
    params,
    headers,
    bodyType,
    body,
  };
}

/** PowerShell 双引号字符串内的反引号转义映射 */
const PS_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  "`": "`",
  '"': '"',
  "'": "'",
  $: "$",
};

/** 浏览器复制的 PowerShell 片段中需要过滤的请求头（HTTP/2 伪头与压缩协商头） */
const PS_SKIPPED_HEADERS = new Set(["authority", "method", "path", "scheme", "accept-encoding"]);

interface PsToken {
  type: "string" | "word";
  value: string;
}

/** 把 PowerShell 命令切分为字符串/标点/单词 token，处理反引号转义与续行 */
function tokenizePowerShell(input: string): PsToken[] {
  const tokens: PsToken[] = [];
  let i = 0;
  const pushWord = (value: string) => tokens.push({ type: "word", value });

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === "`") {
      // 反引号：行尾续行则跳过换行，否则转义下一个字符（并入后续 word）
      i += /^`\r?\n/.test(input.slice(i)) ? (input[i + 1] === "\r" ? 3 : 2) : 1;
    } else if (ch === '"' || ch === "'") {
      const [value, end] = readPsString(input, i);
      tokens.push({ type: "string", value });
      i = end;
    } else if (ch === "@" && input[i + 1] === "{") {
      pushWord("@{");
      i += 2;
    } else if (ch === "}" || ch === "=" || ch === ";") {
      pushWord(ch);
      i += 1;
    } else {
      let word = "";
      while (i < input.length && !/[\s"'`=};]/.test(input[i])) word += input[i++];
      pushWord(word);
    }
  }
  return tokens;
}

/** 从 start 处读取一个 PowerShell 字符串字面量，返回 [值, 结束下标] */
function readPsString(text: string, start: number): [string, number] {
  const quote = text[start];
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) {
      // 单引号内 '' 转义为一个单引号
      if (quote === "'" && text[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return [value, i + 1];
    }
    if (quote === '"' && ch === "`") {
      value += PS_ESCAPES[text[i + 1]] ?? text[i + 1] ?? "";
      i += 2;
      continue;
    }
    value += ch;
    i += 1;
  }
  return [value, i];
}

/**
 * 解析 PowerShell Invoke-WebRequest / Invoke-RestMethod 命令。
 * 支持 -Uri/-Method/-Headers @{...}/-ContentType/-Body 与 $session.UserAgent。
 */
export function parsePowerShell(command: string): ParsedCurl {
  const tokens = tokenizePowerShell(command);
  let method: HttpMethod | null = null;
  let url = "";
  let contentType = "";
  let bodyRaw = "";
  let userAgent = "";
  const headers: KeyValueItem[] = [];

  const nextValue = (i: number): string => tokens[i + 1]?.value ?? "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "word") continue;
    switch (token.value.toLowerCase()) {
      case "-uri":
        url = nextValue(i++);
        break;
      case "-method": {
        const raw = nextValue(i++).toUpperCase();
        if (!METHODS.includes(raw as HttpMethod))
          throw new Error(t("curl.unsupportedMethod", { method: raw }));
        method = raw as HttpMethod;
        break;
      }
      case "-contenttype":
        contentType = nextValue(i++);
        break;
      case "-body":
        bodyRaw = nextValue(i++);
        break;
      case "-headers": {
        if (nextValue(i) !== "@{") break;
        i += 2;
        // 读取哈希表键值对："key"="value"，直到右花括号
        while (i < tokens.length && tokens[i].value !== "}") {
          if (tokens[i + 1]?.value === "=") {
            const key = tokens[i].value;
            const value = tokens[i + 2]?.value ?? "";
            if (!PS_SKIPPED_HEADERS.has(key.toLowerCase())) {
              headers.push({ key, value, enabled: true });
            }
            i += 3;
          } else {
            i += 1;
          }
        }
        break;
      }
      case "$session.useragent":
        if (nextValue(i) === "=") {
          userAgent = tokens[i + 2]?.value ?? "";
          i += 2;
        }
        break;
      default:
        break;
    }
  }

  if (!url) throw new Error(t("curl.noUrl"));
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  if (userAgent && !findHeader(headers, "user-agent")) {
    headers.push({ key: "User-Agent", value: userAgent, enabled: true });
  }
  if (contentType && !findHeader(headers, "content-type")) {
    headers.push({ key: "Content-Type", value: contentType, enabled: true });
  }

  // 拆出 URL 中的 query 参数
  const params: KeyValueItem[] = [];
  const queryIndex = url.indexOf("?");
  if (queryIndex >= 0) {
    params.push(...splitQueryString(url.slice(queryIndex + 1)));
    url = url.slice(0, queryIndex);
  }

  // 推断请求体类型
  let bodyType: BodyType = "none";
  let body = "";
  if (bodyRaw) {
    const type = findHeader(headers, "content-type").toLowerCase();
    if (type.includes("json") || /^\s*[[{]/.test(bodyRaw)) {
      bodyType = "json";
      body = bodyRaw;
    } else if (type.includes("x-www-form-urlencoded")) {
      bodyType = "x-www-form-urlencoded";
      body = JSON.stringify(splitQueryString(bodyRaw));
    } else {
      bodyType = "raw";
      body = bodyRaw;
    }
  }

  return {
    method: method ?? (bodyType === "none" ? "GET" : "POST"),
    url,
    params,
    headers,
    bodyType,
    body,
  };
}
