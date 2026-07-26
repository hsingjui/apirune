import type { BodyType, FormField, HttpMethod, KeyValueItem } from "../types/request";

/** 代码生成入参：路径参数与环境变量已解析完成的请求快照 */
export interface CodegenInput {
  method: HttpMethod;
  url: string;
  /** Query 参数（仅 query，路径参数已替入 URL） */
  params: KeyValueItem[];
  headers: KeyValueItem[];
  bodyType: BodyType;
  /** 请求体原文；form 类为 FormField[] 的 JSON 串 */
  body: string;
}

/** 可生成的代码片段类型 */
export type SnippetKind =
  | "curl"
  | "curl-win"
  | "httpie"
  | "wget"
  | "powershell"
  | "fetch"
  | "axios"
  | "jquery"
  | "xhr"
  | "node-native"
  | "node-request"
  | "unirest"
  | "java-okhttp"
  | "java-unirest"
  | "go-native"
  | "c-libcurl"
  | "python";

/** 片段变体：某语言下的一种生成方式 */
export interface SnippetVariant {
  kind: SnippetKind;
  label: string;
}

/** 语言分组及其下的片段变体（技术名词不做翻译） */
export const SNIPPET_LANGUAGES: { language: string; variants: SnippetVariant[] }[] = [
  {
    language: "Shell",
    variants: [
      { kind: "curl", label: "cURL" },
      { kind: "curl-win", label: "cURL-Windows" },
      { kind: "httpie", label: "Httpie" },
      { kind: "wget", label: "wget" },
      { kind: "powershell", label: "PowerShell" },
    ],
  },
  {
    language: "JavaScript",
    variants: [
      { kind: "fetch", label: "Fetch" },
      { kind: "axios", label: "Axios" },
      { kind: "jquery", label: "jQuery" },
      { kind: "xhr", label: "XHR" },
      { kind: "node-native", label: "Native" },
      { kind: "node-request", label: "Request" },
      { kind: "unirest", label: "Unirest" },
    ],
  },
  {
    language: "Java",
    variants: [
      { kind: "java-okhttp", label: "OkHttp" },
      { kind: "java-unirest", label: "Unirest" },
    ],
  },
  { language: "Go", variants: [{ kind: "go-native", label: "Native" }] },
  { language: "Python", variants: [{ kind: "python", label: "requests" }] },
  { language: "C", variants: [{ kind: "c-libcurl", label: "libcurl" }] },
];

/** 展开后的表单条目：array 类型拆成同名多条 */
interface FormEntry {
  key: string;
  value: string;
  isFile: boolean;
}

/** 解析 form 类请求体（FormField[] 的 JSON 串）并展开 array 多值 */
function parseFormEntries(body: string): FormEntry[] {
  let fields: FormField[];
  try {
    const parsed = JSON.parse(body);
    fields = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  const entries: FormEntry[] = [];
  for (const field of fields) {
    if (!field.key || field.enabled === false) continue;
    if (field.fieldType === "array") {
      for (const value of field.values ?? []) {
        entries.push({ key: field.key, value, isFile: false });
      }
    } else {
      entries.push({ key: field.key, value: field.value, isFile: field.fieldType === "file" });
    }
  }
  return entries;
}

/** 过滤出启用且 key 非空的键值对 */
function enabledItems(items: KeyValueItem[]): KeyValueItem[] {
  return items.filter((item) => item.key && item.enabled !== false);
}

/** 拼接 Query 参数到 URL */
function buildFullUrl(input: CodegenInput): string {
  const params = enabledItems(input.params);
  if (params.length === 0) return input.url;
  const query = params
    .map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
    .join("&");
  return `${input.url}${input.url.includes("?") ? "&" : "?"}${query}`;
}

/** 查找请求头的值（忽略大小写） */
function findHeader(headers: KeyValueItem[], name: string): string {
  return headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** shell 单引号转义：' → '\'' */
function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Windows cmd 双引号转义：" → \"，% → %% */
function winQuote(text: string): string {
  return `"${text.replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

/** PowerShell 单引号转义：' → '' */
function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** 取路径中的文件名 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** 把 form 类请求体拼成 urlencoded 查询串 */
function urlencodedBody(body: string): string {
  return parseFormEntries(body)
    .map((entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`)
    .join("&");
}

/** JS / Python 通用的双引号字符串字面量（JSON 转义对两者均合法） */
function quote(text: string): string {
  return JSON.stringify(text);
}

/** 生成 curl 命令；由 quote / 行连接符区分 Unix 与 Windows 变体 */
function buildCurl(input: CodegenInput, q: (text: string) => string, joiner: string): string {
  const parts: string[] = [
    `curl${input.method === "GET" ? "" : ` -X ${input.method}`} ${q(buildFullUrl(input))}`,
  ];

  const headers = enabledItems(input.headers);
  // JSON 请求体时若未显式设置 Content-Type，补上以避免 curl 默认按表单发送
  const needJsonHeader = input.bodyType === "json" && !findHeader(headers, "content-type");
  for (const header of headers) {
    parts.push(`-H ${q(`${header.key}: ${header.value}`)}`);
  }
  if (needJsonHeader) parts.push(`-H ${q("Content-Type: application/json")}`);

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) parts.push(`-d ${q(input.body)}`);
  } else if (input.bodyType === "x-www-form-urlencoded") {
    for (const entry of parseFormEntries(input.body)) {
      parts.push(`--data-urlencode ${q(`${entry.key}=${entry.value}`)}`);
    }
  } else if (input.bodyType === "form-data") {
    for (const entry of parseFormEntries(input.body)) {
      parts.push(`-F ${q(`${entry.key}=${entry.isFile ? `@${entry.value}` : entry.value}`)}`);
    }
  }
  return parts.join(joiner);
}

/** 生成 curl 命令（Unix shell） */
export function generateCurl(input: CodegenInput): string {
  return buildCurl(input, shQuote, " \\\n  ");
}

/** 生成 curl 命令（Windows cmd：双引号 + ^ 续行） */
export function generateCurlWindows(input: CodegenInput): string {
  return buildCurl(input, winQuote, " ^\n  ");
}

/** 生成 HTTPie 命令 */
export function generateHttpie(input: CodegenInput): string {
  let cmd = "http";
  if (input.bodyType === "x-www-form-urlencoded") cmd += " --form";
  else if (input.bodyType === "form-data") cmd += " --multipart";
  const parts: string[] = [`${cmd} ${input.method} ${shQuote(buildFullUrl(input))}`];

  for (const header of enabledItems(input.headers)) {
    parts.push(shQuote(`${header.key}:${header.value}`));
  }

  if (input.bodyType === "json" || input.bodyType === "raw") {
    // HTTPie 带体时默认 Content-Type: application/json，无需额外补头
    if (input.body) parts.push(`--raw ${shQuote(input.body)}`);
  } else {
    for (const entry of parseFormEntries(input.body)) {
      parts.push(shQuote(`${entry.key}${entry.isFile ? `@${entry.value}` : `=${entry.value}`}`));
    }
  }
  return parts.join(" \\\n  ");
}

/** 生成 wget 命令 */
export function generateWget(input: CodegenInput): string {
  const parts: string[] = [`wget -qO- --method ${input.method}`];
  const headers = enabledItems(input.headers);
  for (const header of headers) {
    parts.push(`--header ${shQuote(`${header.key}: ${header.value}`)}`);
  }

  const prefix: string[] = [];
  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.bodyType === "json" && !findHeader(headers, "content-type")) {
      parts.push(`--header ${shQuote("Content-Type: application/json")}`);
    }
    if (input.body) parts.push(`--body-data ${shQuote(input.body)}`);
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const body = urlencodedBody(input.body);
    if (body) {
      if (!findHeader(headers, "content-type")) {
        parts.push(`--header ${shQuote("Content-Type: application/x-www-form-urlencoded")}`);
      }
      parts.push(`--body-data ${shQuote(body)}`);
    }
  } else if (input.bodyType === "form-data") {
    prefix.push("# wget does not support multipart/form-data; body is omitted");
  }

  parts.push(shQuote(buildFullUrl(input)));
  const cmd = parts.join(" \\\n  ");
  return prefix.length > 0 ? `${prefix.join("\n")}\n${cmd}` : cmd;
}

/** 生成 PowerShell（Invoke-RestMethod）代码 */
export function generatePowershell(input: CodegenInput): string {
  const lines: string[] = [];
  const headers = enabledItems(input.headers);
  const args: string[] = [
    `-Uri ${psQuote(buildFullUrl(input))}`,
    `-Method ${psQuote(input.method)}`,
  ];

  if (headers.length > 0) {
    lines.push("$headers = @{");
    for (const header of headers) {
      lines.push(`    ${psQuote(header.key)} = ${psQuote(header.value)}`);
    }
    lines.push("}");
    args.push("-Headers $headers");
  }

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) {
      if (input.body.includes("\n")) {
        lines.push("$body = @'", input.body, "'@");
      } else {
        lines.push(`$body = ${psQuote(input.body)}`);
      }
      args.push("-Body $body");
      if (input.bodyType === "json" && !findHeader(headers, "content-type")) {
        args.push("-ContentType 'application/json'");
      }
    }
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const body = urlencodedBody(input.body);
    if (body) {
      lines.push(`$body = ${psQuote(body)}`);
      args.push("-Body $body");
      if (!findHeader(headers, "content-type")) {
        args.push("-ContentType 'application/x-www-form-urlencoded'");
      }
    }
  } else if (input.bodyType === "form-data") {
    const entries = parseFormEntries(input.body);
    if (entries.length > 0) {
      // hashtable 键不可重复：同名条目（array 字段展开）合并为数组
      const grouped = new Map<string, string[]>();
      for (const entry of entries) {
        const expr = entry.isFile ? `Get-Item -Path ${psQuote(entry.value)}` : psQuote(entry.value);
        grouped.set(entry.key, [...(grouped.get(entry.key) ?? []), expr]);
      }
      lines.push("$form = @{");
      for (const [key, values] of grouped) {
        lines.push(
          `    ${psQuote(key)} = ${values.length > 1 ? `@(${values.join(", ")})` : values[0]}`,
        );
      }
      lines.push("}");
      args.push("-Form $form");
    }
  }

  if (lines.length > 0) lines.push("");
  lines.push(`$response = Invoke-RestMethod ${args.join(" ")}`);
  lines.push("$response | ConvertTo-Json");
  return lines.join("\n");
}

/** 组装 headers：JSON 体且未显式设置 Content-Type 时自动补上 */
function withJsonHeader(input: CodegenInput): KeyValueItem[] {
  const headers = enabledItems(input.headers);
  if (input.bodyType === "json" && !findHeader(headers, "content-type")) {
    headers.push({ key: "Content-Type", value: "application/json", enabled: true });
  }
  return headers;
}

/** 生成 JS 对象字面量中的 headers 字段行 */
function jsHeaderLines(headers: KeyValueItem[], indent: string): string[] {
  const lines = [`${indent}headers: {`];
  for (const header of headers) {
    lines.push(`${indent}  ${quote(header.key)}: ${quote(header.value)},`);
  }
  lines.push(`${indent}},`);
  return lines;
}

/** 浏览器侧 JS 请求体：返回构造语句与传给请求的表达式 */
function jsBrowserBody(input: CodegenInput): { lines: string[]; expr: string } {
  const lines: string[] = [];
  if (input.bodyType === "json" || input.bodyType === "raw") {
    return { lines, expr: input.body ? quote(input.body) : "" };
  }
  if (input.bodyType === "x-www-form-urlencoded") {
    lines.push("const body = new URLSearchParams();");
    for (const entry of parseFormEntries(input.body)) {
      lines.push(`body.append(${quote(entry.key)}, ${quote(entry.value)});`);
    }
    lines.push("");
    return { lines, expr: "body" };
  }
  lines.push("const body = new FormData();");
  for (const entry of parseFormEntries(input.body)) {
    if (entry.isFile) {
      lines.push(`body.append(${quote(entry.key)}, fileInput.files[0]); // ${entry.value}`);
    } else {
      lines.push(`body.append(${quote(entry.key)}, ${quote(entry.value)});`);
    }
  }
  lines.push("");
  return { lines, expr: "body" };
}

/** 生成 JavaScript fetch 代码 */
export function generateFetch(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const { lines, expr } = jsBrowserBody(input);

  lines.push(`const response = await fetch(${quote(buildFullUrl(input))}, {`);
  lines.push(`  method: ${quote(input.method)},`);
  if (headers.length > 0) lines.push(...jsHeaderLines(headers, "  "));
  if (expr) lines.push(`  body: ${expr},`);
  lines.push("});");
  lines.push("const data = await response.text();");
  lines.push("console.log(data);");
  return lines.join("\n");
}

/** 生成 Axios 代码 */
export function generateAxios(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const { lines, expr } = jsBrowserBody(input);

  lines.push("const config = {");
  lines.push(`  method: ${quote(input.method)},`);
  lines.push(`  url: ${quote(buildFullUrl(input))},`);
  if (headers.length > 0) lines.push(...jsHeaderLines(headers, "  "));
  if (expr) lines.push(`  data: ${expr},`);
  lines.push("};");
  lines.push("");
  lines.push("axios(config)");
  lines.push("  .then((response) => console.log(response.data))");
  lines.push("  .catch((error) => console.error(error));");
  return lines.join("\n");
}

/** 生成 jQuery $.ajax 代码 */
export function generateJquery(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const lines: string[] = [];
  let dataExpr = "";
  const extra: string[] = [];

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) dataExpr = quote(input.body);
  } else if (input.bodyType === "x-www-form-urlencoded") {
    // jQuery 默认按 x-www-form-urlencoded 提交，直接传编码后的字符串
    const body = urlencodedBody(input.body);
    if (body) dataExpr = quote(body);
  } else if (input.bodyType === "form-data") {
    lines.push("const form = new FormData();");
    for (const entry of parseFormEntries(input.body)) {
      if (entry.isFile) {
        lines.push(`form.append(${quote(entry.key)}, fileInput.files[0]); // ${entry.value}`);
      } else {
        lines.push(`form.append(${quote(entry.key)}, ${quote(entry.value)});`);
      }
    }
    lines.push("");
    dataExpr = "form";
    extra.push("  processData: false,", "  contentType: false,");
  }

  lines.push("const settings = {");
  lines.push(`  url: ${quote(buildFullUrl(input))},`);
  lines.push(`  method: ${quote(input.method)},`);
  if (headers.length > 0) lines.push(...jsHeaderLines(headers, "  "));
  if (dataExpr) lines.push(`  data: ${dataExpr},`);
  lines.push(...extra);
  lines.push("};");
  lines.push("");
  lines.push("$.ajax(settings).done((response) => console.log(response));");
  return lines.join("\n");
}

/** 生成 XMLHttpRequest 代码 */
export function generateXhr(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const { lines, expr } = jsBrowserBody(input);

  lines.push("const xhr = new XMLHttpRequest();");
  lines.push(`xhr.open(${quote(input.method)}, ${quote(buildFullUrl(input))});`);
  for (const header of headers) {
    lines.push(`xhr.setRequestHeader(${quote(header.key)}, ${quote(header.value)});`);
  }
  lines.push("xhr.onload = () => console.log(xhr.responseText);");
  lines.push(expr ? `xhr.send(${expr});` : "xhr.send();");
  return lines.join("\n");
}

/** 生成 Node.js 原生 http/https 代码 */
export function generateNodeNative(input: CodegenInput): string {
  const url = buildFullUrl(input);
  const mod = url.startsWith("http://") ? "http" : "https";
  const headers = withJsonHeader(input);
  const lines: string[] = [`const ${mod} = require(${quote(mod)});`, ""];

  let bodyExpr = "";
  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) bodyExpr = quote(input.body);
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const body = urlencodedBody(input.body);
    if (body) {
      bodyExpr = quote(body);
      if (!findHeader(headers, "content-type")) {
        headers.push({
          key: "Content-Type",
          value: "application/x-www-form-urlencoded",
          enabled: true,
        });
      }
    }
  } else if (input.bodyType === "form-data") {
    lines.push("// multipart/form-data: use the form-data package to build the body");
  }

  lines.push("const options = {");
  lines.push(`  method: ${quote(input.method)},`);
  if (headers.length > 0) lines.push(...jsHeaderLines(headers, "  "));
  lines.push("};");
  lines.push("");
  lines.push(`const req = ${mod}.request(${quote(url)}, options, (res) => {`);
  lines.push("  const chunks = [];");
  lines.push('  res.on("data", (chunk) => chunks.push(chunk));');
  lines.push('  res.on("end", () => console.log(Buffer.concat(chunks).toString()));');
  lines.push("});");
  lines.push("");
  if (bodyExpr) lines.push(`req.write(${bodyExpr});`);
  lines.push("req.end();");
  return lines.join("\n");
}

/** 生成 Node.js request 库代码 */
export function generateNodeRequest(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const entries = input.bodyType === "form-data" ? parseFormEntries(input.body) : [];
  const lines: string[] = ['const request = require("request");'];
  if (entries.some((entry) => entry.isFile)) lines.push('const fs = require("fs");');
  lines.push("");

  lines.push("const options = {");
  lines.push(`  method: ${quote(input.method)},`);
  lines.push(`  url: ${quote(buildFullUrl(input))},`);
  if (headers.length > 0) lines.push(...jsHeaderLines(headers, "  "));
  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) lines.push(`  body: ${quote(input.body)},`);
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const body = urlencodedBody(input.body);
    if (body) lines.push(`  form: ${quote(body)},`);
  } else if (input.bodyType === "form-data" && entries.length > 0) {
    // 同名条目（array 字段展开）合并为数组
    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      const expr = entry.isFile ? `fs.createReadStream(${quote(entry.value)})` : quote(entry.value);
      grouped.set(entry.key, [...(grouped.get(entry.key) ?? []), expr]);
    }
    lines.push("  formData: {");
    for (const [key, values] of grouped) {
      lines.push(`    ${quote(key)}: ${values.length > 1 ? `[${values.join(", ")}]` : values[0]},`);
    }
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  lines.push("request(options, (error, response) => {");
  lines.push("  if (error) throw new Error(error);");
  lines.push("  console.log(response.body);");
  lines.push("});");
  return lines.join("\n");
}

/** 生成 Unirest（Node.js）代码 */
export function generateUnirest(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const lines: string[] = ['const unirest = require("unirest");', ""];

  // 请求体链式调用；先算好以便补充 Content-Type
  const bodyCalls: string[] = [];
  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) bodyCalls.push(`  .send(${quote(input.body)})`);
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const body = urlencodedBody(input.body);
    if (body) {
      bodyCalls.push(`  .send(${quote(body)})`);
      if (!findHeader(headers, "content-type")) {
        headers.push({
          key: "Content-Type",
          value: "application/x-www-form-urlencoded",
          enabled: true,
        });
      }
    }
  } else if (input.bodyType === "form-data") {
    for (const entry of parseFormEntries(input.body)) {
      bodyCalls.push(
        entry.isFile
          ? `  .attach(${quote(entry.key)}, ${quote(entry.value)})`
          : `  .field(${quote(entry.key)}, ${quote(entry.value)})`,
      );
    }
  }

  lines.push(`unirest(${quote(input.method)}, ${quote(buildFullUrl(input))})`);
  if (headers.length > 0) {
    lines.push("  .headers({");
    for (const header of headers) {
      lines.push(`    ${quote(header.key)}: ${quote(header.value)},`);
    }
    lines.push("  })");
  }
  lines.push(...bodyCalls);
  lines.push("  .end((res) => {");
  lines.push("    if (res.error) throw new Error(res.error);");
  lines.push("    console.log(res.raw_body);");
  lines.push("  });");
  return lines.join("\n");
}

/** 生成 Java OkHttp 代码 */
export function generateJavaOkhttp(input: CodegenInput): string {
  const headers = enabledItems(input.headers);
  const lines: string[] = ["OkHttpClient client = new OkHttpClient();", ""];
  let bodyExpr = "null";

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) {
      const contentType =
        findHeader(headers, "content-type") ||
        (input.bodyType === "json" ? "application/json" : "text/plain");
      lines.push(`MediaType mediaType = MediaType.parse(${quote(contentType)});`);
      lines.push(`RequestBody body = RequestBody.create(mediaType, ${quote(input.body)});`);
      bodyExpr = "body";
    }
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const entries = parseFormEntries(input.body);
    if (entries.length > 0) {
      lines.push("RequestBody body = new FormBody.Builder()");
      for (const entry of entries) {
        lines.push(`  .add(${quote(entry.key)}, ${quote(entry.value)})`);
      }
      lines.push("  .build();");
      bodyExpr = "body";
    }
  } else if (input.bodyType === "form-data") {
    const entries = parseFormEntries(input.body);
    if (entries.length > 0) {
      lines.push("RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)");
      for (const entry of entries) {
        if (entry.isFile) {
          lines.push(
            `  .addFormDataPart(${quote(entry.key)}, ${quote(baseName(entry.value))},`,
            `    RequestBody.create(MediaType.parse("application/octet-stream"), new File(${quote(entry.value)})))`,
          );
        } else {
          lines.push(`  .addFormDataPart(${quote(entry.key)}, ${quote(entry.value)})`);
        }
      }
      lines.push("  .build();");
      bodyExpr = "body";
    }
  }

  lines.push("Request request = new Request.Builder()");
  lines.push(`  .url(${quote(buildFullUrl(input))})`);
  lines.push(`  .method(${quote(input.method)}, ${bodyExpr})`);
  for (const header of headers) {
    lines.push(`  .addHeader(${quote(header.key)}, ${quote(header.value)})`);
  }
  lines.push("  .build();");
  lines.push("Response response = client.newCall(request).execute();");
  lines.push("System.out.println(response.body().string());");
  return lines.join("\n");
}

/** 生成 Java Unirest 代码 */
export function generateJavaUnirest(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const lines: string[] = [
    `HttpResponse<String> response = Unirest.${input.method.toLowerCase()}(${quote(buildFullUrl(input))})`,
  ];
  for (const header of headers) {
    lines.push(`  .header(${quote(header.key)}, ${quote(header.value)})`);
  }

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) lines.push(`  .body(${quote(input.body)})`);
  } else {
    // urlencoded / form-data 均用 field；Unirest 会自动设置 Content-Type
    for (const entry of parseFormEntries(input.body)) {
      lines.push(
        entry.isFile
          ? `  .field(${quote(entry.key)}, new File(${quote(entry.value)}))`
          : `  .field(${quote(entry.key)}, ${quote(entry.value)})`,
      );
    }
  }
  lines.push("  .asString();");
  lines.push("System.out.println(response.getBody());");
  return lines.join("\n");
}

/** 生成 Go 原生 net/http 代码 */
export function generateGoNative(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  const imports = new Set(["fmt", "io", "net/http"]);
  const bodyLines: string[] = [];
  const afterReqLines: string[] = [];
  let payloadExpr = "nil";

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) {
      imports.add("strings");
      bodyLines.push(`payload := strings.NewReader(${quote(input.body)})`);
      payloadExpr = "payload";
    }
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const body = urlencodedBody(input.body);
    if (body) {
      imports.add("strings");
      bodyLines.push(`payload := strings.NewReader(${quote(body)})`);
      payloadExpr = "payload";
      if (!findHeader(headers, "content-type")) {
        headers.push({
          key: "Content-Type",
          value: "application/x-www-form-urlencoded",
          enabled: true,
        });
      }
    }
  } else if (input.bodyType === "form-data") {
    const entries = parseFormEntries(input.body);
    if (entries.length > 0) {
      imports.add("bytes");
      imports.add("mime/multipart");
      bodyLines.push("payload := &bytes.Buffer{}");
      bodyLines.push("writer := multipart.NewWriter(payload)");
      let fileIndex = 0;
      for (const entry of entries) {
        if (entry.isFile) {
          imports.add("os");
          imports.add("path/filepath");
          fileIndex += 1;
          bodyLines.push(`file${fileIndex}, _ := os.Open(${quote(entry.value)})`);
          bodyLines.push(`defer file${fileIndex}.Close()`);
          bodyLines.push(
            `part${fileIndex}, _ := writer.CreateFormFile(${quote(entry.key)}, filepath.Base(${quote(entry.value)}))`,
          );
          bodyLines.push(`io.Copy(part${fileIndex}, file${fileIndex})`);
        } else {
          bodyLines.push(`writer.WriteField(${quote(entry.key)}, ${quote(entry.value)})`);
        }
      }
      bodyLines.push("writer.Close()");
      payloadExpr = "payload";
      afterReqLines.push('req.Header.Set("Content-Type", writer.FormDataContentType())');
    }
  }

  const lines: string[] = ["package main", "", "import ("];
  for (const name of [...imports].sort()) lines.push(`\t${quote(name)}`);
  lines.push(")", "", "func main() {");
  const body: string[] = [];
  body.push(...bodyLines);
  if (bodyLines.length > 0) body.push("");
  body.push(
    `req, err := http.NewRequest(${quote(input.method)}, ${quote(buildFullUrl(input))}, ${payloadExpr})`,
  );
  body.push("if err != nil {", "\tfmt.Println(err)", "\treturn", "}");
  for (const header of headers) {
    body.push(`req.Header.Add(${quote(header.key)}, ${quote(header.value)})`);
  }
  body.push(...afterReqLines);
  body.push("");
  body.push("res, err := http.DefaultClient.Do(req)");
  body.push("if err != nil {", "\tfmt.Println(err)", "\treturn", "}");
  body.push("defer res.Body.Close()");
  body.push("");
  body.push("data, err := io.ReadAll(res.Body)");
  body.push("if err != nil {", "\tfmt.Println(err)", "\treturn", "}");
  body.push("fmt.Println(string(data))");
  lines.push(...body.map((line) => (line ? `\t${line}` : "")));
  lines.push("}");
  return lines.join("\n");
}

/** 生成 C libcurl 代码 */
export function generateCLibcurl(input: CodegenInput): string {
  const headers = withJsonHeader(input);
  let postFields = "";
  if (input.bodyType === "json" || input.bodyType === "raw") {
    postFields = input.body;
  } else if (input.bodyType === "x-www-form-urlencoded") {
    postFields = urlencodedBody(input.body);
    if (postFields && !findHeader(headers, "content-type")) {
      headers.push({
        key: "Content-Type",
        value: "application/x-www-form-urlencoded",
        enabled: true,
      });
    }
  }
  const formEntries = input.bodyType === "form-data" ? parseFormEntries(input.body) : [];

  const lines: string[] = [
    "#include <stdio.h>",
    "#include <curl/curl.h>",
    "",
    "int main(void)",
    "{",
    "  CURL *curl = curl_easy_init();",
    "  CURLcode res;",
    "",
    "  if (curl) {",
  ];
  if (input.method !== "GET") {
    lines.push(`    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${quote(input.method)});`);
  }
  lines.push(`    curl_easy_setopt(curl, CURLOPT_URL, ${quote(buildFullUrl(input))});`);

  if (headers.length > 0) {
    lines.push("");
    lines.push("    struct curl_slist *headers = NULL;");
    for (const header of headers) {
      lines.push(
        `    headers = curl_slist_append(headers, ${quote(`${header.key}: ${header.value}`)});`,
      );
    }
    lines.push("    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);");
  }

  if (postFields) {
    lines.push("");
    lines.push(`    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, ${quote(postFields)});`);
  } else if (formEntries.length > 0) {
    lines.push("");
    lines.push("    curl_mime *mime = curl_mime_init(curl);");
    lines.push("    curl_mimepart *part;");
    for (const entry of formEntries) {
      lines.push("    part = curl_mime_addpart(mime);");
      lines.push(`    curl_mime_name(part, ${quote(entry.key)});`);
      lines.push(
        entry.isFile
          ? `    curl_mime_filedata(part, ${quote(entry.value)});`
          : `    curl_mime_data(part, ${quote(entry.value)}, CURL_ZERO_TERMINATED);`,
      );
    }
    lines.push("    curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);");
  }

  lines.push("");
  lines.push("    res = curl_easy_perform(curl);");
  lines.push("    if (res != CURLE_OK)");
  lines.push(
    '      fprintf(stderr, "curl_easy_perform() failed: %s\\n", curl_easy_strerror(res));',
  );
  lines.push("");
  if (formEntries.length > 0) lines.push("    curl_mime_free(mime);");
  if (headers.length > 0) lines.push("    curl_slist_free_all(headers);");
  lines.push("    curl_easy_cleanup(curl);");
  lines.push("  }");
  lines.push("  return 0;");
  lines.push("}");
  return lines.join("\n");
}

/** 生成 Python requests 代码 */
export function generatePython(input: CodegenInput): string {
  const lines: string[] = ["import requests", ""];
  const headers = enabledItems(input.headers);
  if (input.bodyType === "json" && !findHeader(headers, "content-type")) {
    headers.push({ key: "Content-Type", value: "application/json", enabled: true });
  }

  lines.push(`url = ${quote(buildFullUrl(input))}`);
  if (headers.length > 0) {
    lines.push("headers = {");
    for (const header of headers) {
      lines.push(`    ${quote(header.key)}: ${quote(header.value)},`);
    }
    lines.push("}");
  }

  const args: string[] = ["url"];
  if (headers.length > 0) args.push("headers=headers");

  if (input.bodyType === "json" || input.bodyType === "raw") {
    if (input.body) {
      lines.push(`data = ${quote(input.body)}`);
      args.push("data=data");
    }
  } else if (input.bodyType === "x-www-form-urlencoded") {
    const entries = parseFormEntries(input.body);
    if (entries.length > 0) {
      lines.push("data = [");
      for (const entry of entries) {
        lines.push(`    (${quote(entry.key)}, ${quote(entry.value)}),`);
      }
      lines.push("]");
      args.push("data=data");
    }
  } else if (input.bodyType === "form-data") {
    const entries = parseFormEntries(input.body);
    const files = entries.filter((entry) => entry.isFile);
    const texts = entries.filter((entry) => !entry.isFile);
    if (texts.length > 0) {
      lines.push("data = [");
      for (const entry of texts) {
        lines.push(`    (${quote(entry.key)}, ${quote(entry.value)}),`);
      }
      lines.push("]");
      args.push("data=data");
    }
    if (files.length > 0) {
      lines.push("files = {");
      for (const entry of files) {
        lines.push(`    ${quote(entry.key)}: open(${quote(entry.value)}, "rb"),`);
      }
      lines.push("}");
      args.push("files=files");
    }
  }

  lines.push("");
  lines.push(`response = requests.${input.method.toLowerCase()}(${args.join(", ")})`);
  lines.push("print(response.text)");
  return lines.join("\n");
}

/** 片段类型到生成器的映射 */
const GENERATORS: Record<SnippetKind, (input: CodegenInput) => string> = {
  curl: generateCurl,
  "curl-win": generateCurlWindows,
  httpie: generateHttpie,
  wget: generateWget,
  powershell: generatePowershell,
  fetch: generateFetch,
  axios: generateAxios,
  jquery: generateJquery,
  xhr: generateXhr,
  "node-native": generateNodeNative,
  "node-request": generateNodeRequest,
  unirest: generateUnirest,
  "java-okhttp": generateJavaOkhttp,
  "java-unirest": generateJavaUnirest,
  "go-native": generateGoNative,
  "c-libcurl": generateCLibcurl,
  python: generatePython,
};

/** 按类型生成代码片段 */
export function generateSnippet(kind: SnippetKind, input: CodegenInput): string {
  return GENERATORS[kind](input);
}
