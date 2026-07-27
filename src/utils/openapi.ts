import { parse as parseYaml } from "yaml";
import { t } from "../i18n";
import type { BodyType, FormField, HttpMethod, KeyValueItem } from "../types/request";

/** OpenAPI 文档解析出的单个请求，可直接入库为快捷请求 */
export interface ParsedOperation {
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  bodyType: BodyType;
  /** 请求体原文；form 类为 FormField[] 的 JSON 串 */
  body: string;
}

/** 按 tag 分组的请求；name 为 null 表示无 tag 的根级请求 */
export interface ParsedGroup {
  name: string | null;
  operations: ParsedOperation[];
}

/** OpenAPI 文档解析结果 */
export interface ParsedOpenApi {
  /** 文档标题（info.title），作为导入根目录名 */
  title: string;
  groups: ParsedGroup[];
  operationCount: number;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 宽松的 JSON 对象类型，OpenAPI 文档节点均按此访问 */
type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析 #/a/b/c 形式的文档内引用；解析失败返回 undefined */
function resolveRef(doc: Obj, ref: unknown): Obj | undefined {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    if (!isObj(node)) return undefined;
    node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isObj(node) ? node : undefined;
}

/** 展开节点的 $ref（若有），返回引用目标或节点本身 */
function deref(doc: Obj, node: unknown): Obj | undefined {
  if (!isObj(node)) return undefined;
  if (node.$ref !== undefined) return resolveRef(doc, node.$ref) ?? undefined;
  return node;
}

/**
 * 根据 schema 生成示例值：优先 example / default / enum，
 * 其次按类型给出零值；$ref 循环引用时返回 null 兜底。
 */
function sampleFromSchema(doc: Obj, schema: unknown, seen: Set<Obj>): unknown {
  const node = deref(doc, schema);
  if (!node) return null;
  if (seen.has(node)) return null;
  seen.add(node);
  try {
    if (node.example !== undefined) return node.example;
    if (node.default !== undefined) return node.default;
    if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
    // allOf：合并各子 schema 的对象示例
    if (Array.isArray(node.allOf)) {
      const merged: Obj = {};
      for (const sub of node.allOf) {
        const sample = sampleFromSchema(doc, sub, seen);
        if (isObj(sample)) Object.assign(merged, sample);
      }
      return merged;
    }
    // oneOf / anyOf：取第一个分支
    const branches = node.oneOf ?? node.anyOf;
    if (Array.isArray(branches) && branches.length > 0) {
      return sampleFromSchema(doc, branches[0], seen);
    }
    const type = Array.isArray(node.type) ? node.type[0] : node.type;
    if (type === "object" || isObj(node.properties)) {
      const result: Obj = {};
      if (isObj(node.properties)) {
        for (const [key, prop] of Object.entries(node.properties)) {
          result[key] = sampleFromSchema(doc, prop, seen);
        }
      }
      return result;
    }
    if (type === "array") {
      const item = sampleFromSchema(doc, node.items, seen);
      return item === null && !isObj(node.items) ? [] : [item];
    }
    if (type === "string") return typeof node.format === "string" ? node.format : "string";
    if (type === "integer" || type === "number") return 0;
    if (type === "boolean") return false;
    return null;
  } finally {
    seen.delete(node);
  }
}

/** 参数示例值：优先 example / schema 内示例，非字符串时序列化 */
function paramExample(doc: Obj, param: Obj): string {
  const value =
    param.example !== undefined
      ? param.example
      : param.schema !== undefined
        ? sampleFromSchema(doc, param.schema, new Set())
        : sampleFromSchema(doc, param, new Set());
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 取 3.x servers[0].url 或 2.0 host/basePath 作为 URL 前缀 */
function baseUrl(doc: Obj): string {
  if (Array.isArray(doc.servers) && isObj(doc.servers[0])) {
    const url = doc.servers[0].url;
    if (typeof url === "string") return url.replace(/\/+$/, "");
  }
  if (typeof doc.host === "string" && doc.host) {
    const scheme =
      Array.isArray(doc.schemes) && typeof doc.schemes[0] === "string" ? doc.schemes[0] : "https";
    const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
    return `${scheme}://${doc.host}${basePath}`.replace(/\/+$/, "");
  }
  return "";
}

/** 合并 path 级与 operation 级参数（operation 同名同位置者优先），并展开 $ref */
function mergeParameters(doc: Obj, pathItem: Obj, operation: Obj): Obj[] {
  const merged = new Map<string, Obj>();
  for (const list of [pathItem.parameters, operation.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const param = deref(doc, raw);
      if (!param || typeof param.name !== "string") continue;
      merged.set(`${param.in}:${param.name}`, param);
    }
  }
  return [...merged.values()];
}

/** 从 content（3.x 的 mediaType 映射）推断请求体，返回 [bodyType, body] */
function bodyFromContent(doc: Obj, content: Obj): [BodyType, string] {
  const pick = (match: (type: string) => boolean): [string, Obj] | undefined => {
    for (const [mediaType, media] of Object.entries(content)) {
      if (match(mediaType.toLowerCase()) && isObj(media)) return [mediaType, media];
    }
    return undefined;
  };

  const json = pick((type) => type.includes("json"));
  if (json) {
    const sample = sampleFromSchema(doc, json[1].schema, new Set());
    return ["json", JSON.stringify(sample ?? {}, null, 2)];
  }

  const form = pick(
    (type) => type.includes("x-www-form-urlencoded") || type.includes("multipart/form-data"),
  );
  if (form) {
    const [mediaType, media] = form;
    const schema = deref(doc, media.schema);
    const fields: FormField[] = [];
    if (schema && isObj(schema.properties)) {
      for (const [key, raw] of Object.entries(schema.properties)) {
        const prop = deref(doc, raw);
        const isFile = prop?.format === "binary";
        fields.push({
          key,
          value: isFile ? "" : String(paramExampleValue(doc, raw)),
          enabled: true,
          ...(isFile ? { fieldType: "file" as const } : {}),
        });
      }
    }
    const bodyType: BodyType = mediaType.toLowerCase().includes("multipart")
      ? "form-data"
      : "x-www-form-urlencoded";
    return [bodyType, JSON.stringify(fields)];
  }

  // 其余类型（text/xml 等）：给出 schema 示例或留空
  const first = Object.values(content).find(isObj);
  if (first) {
    const sample = sampleFromSchema(doc, first.schema, new Set());
    if (sample !== null && sample !== undefined) {
      return ["raw", typeof sample === "string" ? sample : JSON.stringify(sample, null, 2)];
    }
  }
  return ["none", ""];
}

/** 表单字段示例值：字符串原样，其余序列化，空值给空串 */
function paramExampleValue(doc: Obj, schema: unknown): string {
  const value = sampleFromSchema(doc, schema, new Set());
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 解析单个 operation 为请求配置 */
function parseOperation(
  doc: Obj,
  prefix: string,
  path: string,
  method: HttpMethod,
  pathItem: Obj,
  operation: Obj,
): ParsedOperation {
  const params: KeyValueItem[] = [];
  const headers: KeyValueItem[] = [];
  let bodyType: BodyType = "none";
  let body = "";
  let formFields: FormField[] | null = null;

  for (const param of mergeParameters(doc, pathItem, operation)) {
    const name = param.name as string;
    const item: KeyValueItem = {
      key: name,
      value: paramExample(doc, param),
      enabled: true,
      ...(typeof param.description === "string" && param.description
        ? { description: param.description }
        : {}),
    };
    switch (param.in) {
      case "query":
        params.push(item);
        break;
      case "path":
        params.push({ ...item, enabled: true, type: "path" });
        break;
      case "header":
        headers.push({ ...item, enabled: true });
        break;
      case "formData": {
        // Swagger 2.0 表单参数
        formFields ??= [];
        formFields.push({
          key: name,
          value: param.type === "file" ? "" : paramExample(doc, param),
          enabled: true,
          ...(param.type === "file" ? { fieldType: "file" as const } : {}),
        });
        break;
      }
      case "body": {
        // Swagger 2.0 请求体参数
        const sample = sampleFromSchema(doc, param.schema, new Set());
        bodyType = "json";
        body = JSON.stringify(sample ?? {}, null, 2);
        break;
      }
      default:
        break;
    }
  }

  if (formFields) {
    const consumes = Array.isArray(operation.consumes) ? operation.consumes.join(",") : "";
    bodyType =
      consumes.includes("multipart") || formFields.some((f) => f.fieldType === "file")
        ? "form-data"
        : "x-www-form-urlencoded";
    body = JSON.stringify(formFields);
  }

  // OpenAPI 3.x requestBody
  const requestBody = deref(doc, operation.requestBody);
  if (requestBody && isObj(requestBody.content)) {
    [bodyType, body] = bodyFromContent(doc, requestBody.content);
  }

  const name =
    (typeof operation.summary === "string" && operation.summary.trim()) ||
    (typeof operation.operationId === "string" && operation.operationId) ||
    `${method} ${path}`;

  return { name, method, url: `${prefix}${path}`, params, headers, bodyType, body };
}

/**
 * 解析 OpenAPI 3.x / Swagger 2.0 文档（JSON 或 YAML），
 * 按第一个 tag 分组；无 tag 的请求归入 name 为 null 的组。
 */
export function parseOpenApi(text: string): ParsedOpenApi {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = parseYaml(text);
    } catch {
      throw new Error(t("openapi.parseFailed"));
    }
  }
  if (!isObj(doc) || (doc.openapi === undefined && doc.swagger === undefined)) {
    throw new Error(t("openapi.notOpenApi"));
  }
  if (!isObj(doc.paths)) {
    throw new Error(t("openapi.noPaths"));
  }

  const prefix = baseUrl(doc);
  const info = isObj(doc.info) ? doc.info : {};
  const title = typeof info.title === "string" && info.title.trim() ? info.title.trim() : "OpenAPI";

  const groups = new Map<string | null, ParsedOperation[]>();
  let operationCount = 0;

  for (const [path, rawItem] of Object.entries(doc.paths)) {
    const pathItem = deref(doc, rawItem);
    if (!pathItem) continue;
    for (const method of METHODS) {
      const operation = pathItem[method.toLowerCase()];
      if (!isObj(operation)) continue;
      const tag =
        Array.isArray(operation.tags) && typeof operation.tags[0] === "string"
          ? operation.tags[0]
          : null;
      const parsed = parseOperation(doc, prefix, path, method, pathItem, operation);
      const list = groups.get(tag) ?? [];
      list.push(parsed);
      groups.set(tag, list);
      operationCount += 1;
    }
  }

  if (operationCount === 0) {
    throw new Error(t("openapi.noOperations"));
  }

  return {
    title,
    groups: [...groups.entries()].map(([name, operations]) => ({ name, operations })),
    operationCount,
  };
}
