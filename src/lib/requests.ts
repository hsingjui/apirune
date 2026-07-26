import Database from "@tauri-apps/plugin-sql";
import type {
  ApiRequest,
  BodyType,
  CreateFolderInput,
  CreateRequestInput,
  Folder,
  HttpMethod,
  KeyValueItem,
  UpdateFolderInput,
  UpdateRequestInput,
} from "../types/request";
import { createId } from "../utils/id";

const DB_URI = "sqlite:apirune.db";

function getDb(): Promise<Database> {
  return Database.load(DB_URI);
}

/** 数据库行（snake_case）到前端模型（camelCase）的映射 */
type FolderRow = {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

type RequestRow = {
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

function toFolder(row: FolderRow): Folder {
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

function toRequest(row: RequestRow): ApiRequest {
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

/** 列出项目下全部目录，按排序值与创建时间排列 */
export async function listFolders(projectId: string): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    "SELECT * FROM folders WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [projectId],
  );
  return rows.map(toFolder);
}

/** 新建目录 */
export async function createFolder(input: CreateFolderInput): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = {
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
    "INSERT INTO folders (id, project_id, parent_id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
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
async function collectFolderIds(db: Database, id: string): Promise<string[]> {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    const children = await db.select<{ id: string }[]>(
      "SELECT id FROM folders WHERE parent_id = $1",
      [ids[i]],
    );
    ids.push(...children.map((row) => row.id));
  }
  return ids;
}

/** 更新目录（部分字段：改名/移动/排序），自动刷新 updatedAt。目录不存在或移动成环时抛错 */
export async function updateFolder(
  id: string,
  input: UpdateFolderInput,
): Promise<Folder> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    "SELECT * FROM folders WHERE id = $1",
    [id],
  );
  if (rows.length === 0) {
    throw new Error(`目录不存在: ${id}`);
  }
  const existing = toFolder(rows[0]);
  const merged: Folder = { ...existing, ...input, updatedAt: Date.now() };
  // 防环：不能移到自己或自己的子孙目录下
  if (merged.parentId !== existing.parentId && merged.parentId !== null) {
    const descendants = await collectFolderIds(db, id);
    if (descendants.includes(merged.parentId)) {
      throw new Error("不能将目录移动到自身或其子目录中");
    }
  }
  await db.execute(
    "UPDATE folders SET parent_id = $1, name = $2, sort_order = $3, updated_at = $4 WHERE id = $5",
    [merged.parentId, merged.name, merged.sortOrder, merged.updatedAt, id],
  );
  return merged;
}

/** 删除目录，级联删除其子目录与目录下的请求 */
export async function deleteFolder(id: string): Promise<void> {
  const db = await getDb();
  const ids = await collectFolderIds(db, id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(`DELETE FROM requests WHERE folder_id IN (${placeholders})`, ids);
  await db.execute(`DELETE FROM folders WHERE id IN (${placeholders})`, ids);
}

// ---------- 请求 ----------

/** 列出项目下全部请求，按排序值与创建时间排列 */
export async function listRequests(projectId: string): Promise<ApiRequest[]> {
  const db = await getDb();
  const rows = await db.select<RequestRow[]>(
    "SELECT * FROM requests WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [projectId],
  );
  return rows.map(toRequest);
}

/** 按 id 查单个请求，不存在返回 null */
export async function getRequest(id: string): Promise<ApiRequest | null> {
  const db = await getDb();
  const rows = await db.select<RequestRow[]>(
    "SELECT * FROM requests WHERE id = $1",
    [id],
  );
  return rows.length > 0 ? toRequest(rows[0]) : null;
}

/** 新建请求 */
export async function createRequest(input: CreateRequestInput): Promise<ApiRequest> {
  const now = Date.now();
  const request: ApiRequest = {
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
    "INSERT INTO requests (id, project_id, folder_id, name, method, url, params, headers, body_type, body, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
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

/** 更新请求（部分字段），自动刷新 updatedAt。请求不存在时抛错 */
export async function updateRequest(
  id: string,
  input: UpdateRequestInput,
): Promise<ApiRequest> {
  const existing = await getRequest(id);
  if (!existing) {
    throw new Error(`请求不存在: ${id}`);
  }
  const merged: ApiRequest = { ...existing, ...input, updatedAt: Date.now() };
  const db = await getDb();
  await db.execute(
    "UPDATE requests SET folder_id = $1, name = $2, method = $3, url = $4, params = $5, headers = $6, body_type = $7, body = $8, sort_order = $9, updated_at = $10 WHERE id = $11",
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

/** 删除请求。请求不存在时抛错 */
export async function deleteRequest(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM requests WHERE id = $1", [id]);
  if (result.rowsAffected === 0) {
    throw new Error(`请求不存在: ${id}`);
  }
}

/** 删除项目下全部目录、请求与历史（删除项目时调用） */
export async function deleteProjectData(projectId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM history WHERE project_id = $1", [projectId]);
  await db.execute("DELETE FROM requests WHERE project_id = $1", [projectId]);
  await db.execute("DELETE FROM folders WHERE project_id = $1", [projectId]);
}
