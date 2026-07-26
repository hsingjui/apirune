/** HTTP 请求方法 */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** 请求体类型 */
export type BodyType = "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw";

/** 键值对条目，用于 Query 参数 / 请求头 / 表单 */
export interface KeyValueItem {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
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
  /** 请求体原文；form 类为 KeyValueItem[] 的 JSON 串 */
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
