/** HTTP 请求方法 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** 请求体类型 */
export type BodyType = "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw";

/** 键值对条目，用于 Query 参数 / 请求头 / 表单 */
export interface KeyValueItem {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  /** 参数位置：path 表示 URL 路径参数（{name} 占位符），缺省为 query */
  type?: "query" | "path";
}

/** 表单字段类型：text 文本（缺省）/ file 文件 / array 同名多值 */
export type FormFieldType = "text" | "file" | "array";

/** 表单字段条目，form 类请求体（body 为其 JSON 串）使用 */
export interface FormField {
  key: string;
  /** text 的字段值；file 为文件绝对路径 */
  value: string;
  enabled: boolean;
  /** 字段类型，缺省 text */
  fieldType?: FormFieldType;
  /** array 类型的多个值，发送时同名 key 重复发送 */
  values?: string[];
}

/** 接口目录，parentId 为 null 表示根级 */
export interface Folder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 已保存的请求，folderId 为 null 表示根级 */
export interface ApiRequest {
  id: string;
  projectId: string;
  folderId: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  bodyType: BodyType;
  /** 请求体原文；form 类为 FormField[] 的 JSON 串 */
  body: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateFolderInput {
  projectId: string;
  parentId?: string | null;
  name: string;
  sortOrder?: number;
}

export interface CreateRequestInput {
  projectId: string;
  folderId?: string | null;
  name: string;
  method?: HttpMethod;
  url?: string;
  params?: KeyValueItem[];
  headers?: KeyValueItem[];
  bodyType?: BodyType;
  body?: string;
  sortOrder?: number;
}

/** 更新目录时可改动的字段（改名/移动/排序） */
export type UpdateFolderInput = Partial<
  Omit<Folder, "id" | "projectId" | "createdAt" | "updatedAt">
>;

/** 更新请求时可改动的字段（不含 projectId 与时间戳） */
export type UpdateRequestInput = Partial<
  Omit<ApiRequest, "id" | "projectId" | "createdAt" | "updatedAt">
>;
