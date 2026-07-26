import Database from "@tauri-apps/plugin-sql";
import type {
  CreateQuickFolderInput,
  CreateQuickRequestInput,
  QuickFolder,
  QuickRequest,
  UpdateQuickFolderInput,
  UpdateQuickRequestInput,
} from "../types/quick";
import type { BodyType, HttpMethod, KeyValueItem } from "../types/request";
import { createId } from "../utils/id";

const DB_URI = "sqlite:apirune.db";

function getDb(): Promise<Database> {
  return Database.load(DB_URI);
}

/** 数据库行（snake_case）到前端模型（camelCase）的映射 */
type QuickFolderRow = {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

type QuickRequestRow = {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  method: string;
  url: string;
  params: string;
  headers: string;
  body_type: string;
  body: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

function toQuickFolder(row: QuickFolderRow): QuickFolder {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseKeyValueList(json: string): KeyValueItem[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toQuickRequest(row: QuickRequestRow): QuickRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    folderId: row.folder_id,
    name: row.name,
    method: row.method as HttpMethod,
    url: row.url,
    params: parseKeyValueList(row.params),
    headers: parseKeyValueList(row.headers),
    bodyType: row.body_type as BodyType,
    body: row.body,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 目录 ----------

/** 列出项目下全部快捷请求目录，按排序值与创建时间排列 */
export async function listQuickFolders(projectId: string): Promise<QuickFolder[]> {
  const db = await getDb();
  const rows = await db.select<QuickFolderRow[]>(
    "SELECT * FROM quick_folders WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [projectId],
  );
  return rows.map(toQuickFolder);
}

/** 新建快捷请求目录 */
export async function createQuickFolder(input: CreateQuickFolderInput): Promise<QuickFolder> {
  const now = Date.now();
  const folder: QuickFolder = {
    id: createId(),
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    name: input.name,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.execute(
    "INSERT INTO quick_folders (id, project_id, parent_id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      folder.id,
      folder.projectId,
      folder.parentId,
      folder.name,
      folder.sortOrder,
      folder.createdAt,
      folder.updatedAt,
    ],
  );
  return folder;
}

/** 收集目录自身及全部子孙目录的 id */
async function collectQuickFolderIds(db: Database, id: string): Promise<string[]> {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    const children = await db.select<{ id: string }[]>(
      "SELECT id FROM quick_folders WHERE parent_id = $1",
      [ids[i]],
    );
    ids.push(...children.map((row) => row.id));
  }
  return ids;
}

/** 更新目录（部分字段：改名/移动/排序），自动刷新 updatedAt。目录不存在或移动成环时抛错 */
export async function updateQuickFolder(
  id: string,
  input: UpdateQuickFolderInput,
): Promise<QuickFolder> {
  const db = await getDb();
  const rows = await db.select<QuickFolderRow[]>("SELECT * FROM quick_folders WHERE id = $1", [id]);
  if (rows.length === 0) {
    throw new Error(`目录不存在: ${id}`);
  }
  const existing = toQuickFolder(rows[0]);
  const merged: QuickFolder = { ...existing, ...input, updatedAt: Date.now() };
  // 防环：不能移到自己或自己的子孙目录下
  if (merged.parentId !== existing.parentId && merged.parentId !== null) {
    const descendants = await collectQuickFolderIds(db, id);
    if (descendants.includes(merged.parentId)) {
      throw new Error("不能将目录移动到自身或其子目录中");
    }
  }
  await db.execute(
    "UPDATE quick_folders SET parent_id = $1, name = $2, sort_order = $3, updated_at = $4 WHERE id = $5",
    [merged.parentId, merged.name, merged.sortOrder, merged.updatedAt, id],
  );
  return merged;
}

/** 删除目录，级联删除其子目录与目录下的快捷请求 */
export async function deleteQuickFolder(id: string): Promise<void> {
  const db = await getDb();
  const ids = await collectQuickFolderIds(db, id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(`DELETE FROM quick_requests WHERE folder_id IN (${placeholders})`, ids);
  await db.execute(`DELETE FROM quick_folders WHERE id IN (${placeholders})`, ids);
}

// ---------- 请求 ----------

/** 列出项目下全部快捷请求，按排序值与创建时间排列 */
export async function listQuickRequests(projectId: string): Promise<QuickRequest[]> {
  const db = await getDb();
  const rows = await db.select<QuickRequestRow[]>(
    "SELECT * FROM quick_requests WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [projectId],
  );
  return rows.map(toQuickRequest);
}

/** 跨项目列出全部快捷请求，按最近更新排序，用于主页全局搜索 */
export async function listAllQuickRequests(): Promise<QuickRequest[]> {
  const db = await getDb();
  const rows = await db.select<QuickRequestRow[]>(
    "SELECT * FROM quick_requests ORDER BY updated_at DESC",
  );
  return rows.map(toQuickRequest);
}

/** 按 id 查单个快捷请求，不存在返回 null */
export async function getQuickRequest(id: string): Promise<QuickRequest | null> {
  const db = await getDb();
  const rows = await db.select<QuickRequestRow[]>("SELECT * FROM quick_requests WHERE id = $1", [
    id,
  ]);
  return rows.length > 0 ? toQuickRequest(rows[0]) : null;
}

/** 新建快捷请求 */
export async function createQuickRequest(input: CreateQuickRequestInput): Promise<QuickRequest> {
  const now = Date.now();
  const request: QuickRequest = {
    id: createId(),
    projectId: input.projectId,
    folderId: input.folderId ?? null,
    name: input.name,
    method: input.method ?? "GET",
    url: input.url ?? "",
    params: input.params ?? [],
    headers: input.headers ?? [],
    bodyType: input.bodyType ?? "none",
    body: input.body ?? "",
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.execute(
    "INSERT INTO quick_requests (id, project_id, folder_id, name, method, url, params, headers, body_type, body, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    [
      request.id,
      request.projectId,
      request.folderId,
      request.name,
      request.method,
      request.url,
      JSON.stringify(request.params),
      JSON.stringify(request.headers),
      request.bodyType,
      request.body,
      request.sortOrder,
      request.createdAt,
      request.updatedAt,
    ],
  );
  return request;
}

/** 更新快捷请求（部分字段），自动刷新 updatedAt。请求不存在时抛错 */
export async function updateQuickRequest(
  id: string,
  input: UpdateQuickRequestInput,
): Promise<QuickRequest> {
  const existing = await getQuickRequest(id);
  if (!existing) {
    throw new Error(`快捷请求不存在: ${id}`);
  }
  const merged: QuickRequest = { ...existing, ...input, updatedAt: Date.now() };
  const db = await getDb();
  await db.execute(
    "UPDATE quick_requests SET folder_id = $1, name = $2, method = $3, url = $4, params = $5, headers = $6, body_type = $7, body = $8, sort_order = $9, updated_at = $10 WHERE id = $11",
    [
      merged.folderId,
      merged.name,
      merged.method,
      merged.url,
      JSON.stringify(merged.params),
      JSON.stringify(merged.headers),
      merged.bodyType,
      merged.body,
      merged.sortOrder,
      merged.updatedAt,
      id,
    ],
  );
  return merged;
}

/** 删除快捷请求。请求不存在时抛错 */
export async function deleteQuickRequest(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM quick_requests WHERE id = $1", [id]);
  if (result.rowsAffected === 0) {
    throw new Error(`快捷请求不存在: ${id}`);
  }
}

/** 删除项目下全部快捷请求目录与请求（删除项目时调用） */
export async function deleteQuickData(projectId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM quick_requests WHERE project_id = $1", [projectId]);
  await db.execute("DELETE FROM quick_folders WHERE project_id = $1", [projectId]);
}
