import type { BodyType, HttpMethod, KeyValueItem } from "./request";

/**
 * 快捷请求独立于接口（Folder / ApiRequest）分表存储，
 * 两者格式后续可能分化，字段暂时相同但不复用类型。
 */

/** 快捷请求目录，parentId 为 null 表示根级 */
export interface QuickFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 已保存的快捷请求，folderId 为 null 表示根级 */
export interface QuickRequest {
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

export interface CreateQuickFolderInput {
  projectId: string;
  parentId?: string | null;
  name: string;
  sortOrder?: number;
}

export interface CreateQuickRequestInput {
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
export type UpdateQuickFolderInput = Partial<
  Omit<QuickFolder, "id" | "projectId" | "createdAt" | "updatedAt">
>;

/** 更新请求时可改动的字段（不含 projectId 与时间戳） */
export type UpdateQuickRequestInput = Partial<
  Omit<QuickRequest, "id" | "projectId" | "createdAt" | "updatedAt">
>;
