import type { Environment, EnvVariable, ProjectGlobals } from "../types/environment";
import type { AuthConfig, SendRequestInput } from "../types/http";
import type { KeyValueItem } from "../types/request";

/** 变量占位符语法：{{变量名}} */
const VAR_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/** 合并变量表：环境变量覆盖同名全局变量 */
function buildVariableMap(globalVars: EnvVariable[], envVars: EnvVariable[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of globalVars) if (item.name) map.set(item.name, item.value);
  for (const item of envVars) if (item.name) map.set(item.name, item.value);
  return map;
}

/** 替换文本中的 {{变量}} 占位符；未定义的变量保留原样 */
function replaceVariables(text: string, vars: Map<string, string>): string {
  if (!text || vars.size === 0) return text;
  return text.replace(VAR_PATTERN, (raw, name: string) => vars.get(name) ?? raw);
}

/** 对键值对列表做变量替换 */
function resolveItems(
  items: KeyValueItem[] | undefined,
  vars: Map<string, string>,
): KeyValueItem[] {
  return (items ?? []).map((item) => ({
    ...item,
    key: replaceVariables(item.key, vars),
    value: replaceVariables(item.value, vars),
  }));
}

/** 拼接前置 URL 与相对路径；url 已是完整地址或未设置前置 URL 时原样返回 */
function applyBaseUrl(url: string, baseUrl: string): string {
  if (!baseUrl || /^https?:\/\//i.test(url)) return url;
  const base = baseUrl.replace(/\/+$/, "");
  if (!url) return base;
  return `${base}/${url.replace(/^\/+/, "")}`;
}

/**
 * 解析环境级鉴权：对字段做变量替换；请求头 / 参数中已有同名项时返回 undefined（请求优先）
 */
function resolveEnvAuth(
  auth: AuthConfig | undefined,
  headers: KeyValueItem[],
  params: KeyValueItem[],
  vars: Map<string, string>,
): AuthConfig | undefined {
  if (!auth || auth.authType === "none") return undefined;
  const hasHeader = (name: string) =>
    headers.some((h) => h.enabled && h.key.toLowerCase() === name.toLowerCase());
  if (auth.authType === "bearer" || auth.authType === "basic") {
    if (hasHeader("Authorization")) return undefined;
    return auth.authType === "bearer"
      ? { authType: "bearer", token: replaceVariables(auth.token ?? "", vars) }
      : {
          authType: "basic",
          username: replaceVariables(auth.username ?? "", vars),
          password: replaceVariables(auth.password ?? "", vars),
        };
  }
  // api-key
  const key = replaceVariables(auth.key ?? "", vars);
  if (!key) return undefined;
  const addTo = auth.addTo === "query" ? "query" : "header";
  const conflict =
    addTo === "header" ? hasHeader(key) : params.some((p) => p.enabled && p.key === key);
  if (conflict) return undefined;
  return { authType: "api-key", key, value: replaceVariables(auth.value ?? "", vars), addTo };
}

/**
 * 发送前应用环境配置：
 * 1. 用全局变量 + 当前环境变量替换 URL / 参数 / 请求头 / 请求体中的 {{变量}}
 * 2. 相对路径拼接当前环境的前置 URL
 * 3. 附加全局参数到请求头 / Cookie / Query，请求中已有同名项时以请求为准
 * 4. 注入环境级鉴权，请求头 / 参数中已有同名项时以请求为准
 */
export function resolveRequestWithEnv(
  input: SendRequestInput,
  env: Environment | null,
  globals: ProjectGlobals,
): SendRequestInput & { params: KeyValueItem[]; headers: KeyValueItem[]; body: string } {
  const vars = buildVariableMap(globals.variables, env?.variables ?? []);
  const params = resolveItems(input.params, vars);
  const headers = resolveItems(input.headers, vars);

  const cookies: { name: string; value: string }[] = [];
  for (const param of globals.params) {
    if (!param.name) continue;
    const name = replaceVariables(param.name, vars);
    const value = replaceVariables(param.value, vars);
    if (param.in === "header") {
      if (!headers.some((h) => h.key.toLowerCase() === name.toLowerCase())) {
        headers.push({ key: name, value, enabled: true });
      }
    } else if (param.in === "cookie") {
      if (!cookies.some((c) => c.name === name)) {
        cookies.push({ name, value });
      }
    } else if (!params.some((p) => p.key === name)) {
      params.push({ key: name, value, enabled: true });
    }
  }

  // Cookie 类型参数合并进 Cookie 请求头；请求已有同名 Cookie 时以请求为准
  if (cookies.length > 0) {
    const existing = headers.find((h) => h.key.toLowerCase() === "cookie");
    const existingNames = new Set(
      (existing?.value ?? "")
        .split(";")
        .map((pair) => pair.split("=")[0]?.trim())
        .filter(Boolean),
    );
    const additions = cookies
      .filter((c) => !existingNames.has(c.name))
      .map((c) => `${c.name}=${c.value}`);
    if (additions.length > 0) {
      if (existing) {
        existing.value = existing.value
          ? `${existing.value}; ${additions.join("; ")}`
          : additions.join("; ");
      } else {
        headers.push({ key: "Cookie", value: additions.join("; "), enabled: true });
      }
    }
  }

  const baseUrl = env ? replaceVariables(env.baseUrl.trim(), vars) : "";
  const url = applyBaseUrl(replaceVariables(input.url, vars), baseUrl);
  const body = replaceVariables(input.body ?? "", vars);
  // 请求自身已配置鉴权时不覆盖
  const auth =
    input.auth && input.auth.authType !== "none"
      ? input.auth
      : (resolveEnvAuth(env?.auth, headers, params, vars) ?? input.auth);
  return { ...input, url, params, headers, body, auth };
}
