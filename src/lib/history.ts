import Database from "@tauri-apps/plugin-sql";
import type {
  AddHistoryInput,
  HistoryEntry,
  HistoryEntrySummary,
} from "../types/history";
import type { BodyType, HttpMethod, KeyValueItem } from "../types/request";
import { createId } from "../utils/id";

const DB_URI = "sqlite:apirune.db";

function getDb(): Promise<Database> {
  return Database.load(DB_URI);
}

/** 数据库行（snake_case）到前端模型（camelCase）的映射 */
type HistoryRow = {
  id: string;
  project_id: string;
  request_id: string | null;
  method: string;
  url: string;
  params: string;
  headers: string;
  body_type: string;
  body: string;
  status: number | null;
  duration_ms: number | null;
  response_headers: string;
  response_body: string;
  error: string | null;
  created_at: number;
};

type HistorySummaryRow = Omit<
  HistoryRow,
  "params" | "headers" | "body_type" | "body" | "response_headers" | "response_body"
>;

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function toSummary(row: HistorySummaryRow): HistoryEntrySummary {
  return {
    id: row.id,
    projectId: row.project_id,
    requestId: row.request_id,
    method: row.method as HttpMethod,
    url: row.url,
    status: row.status,
    durationMs: row.duration_ms,
    error: row.error,
    createdAt: row.created_at,
  };
}

function toEntry(row: HistoryRow): HistoryEntry {
  return {
    ...toSummary(row),
    params: parseJson<KeyValueItem[]>(row.params, []),
    headers: parseJson<KeyValueItem[]>(row.headers, []),
    bodyType: row.body_type as BodyType,
    body: row.body,
    responseHeaders: parseJson<Record<string, string>>(row.response_headers, {}),
    responseBody: row.response_body,
  };
}

/** 分页列出项目下的历史（不含大字段），按发送时间倒序 */
export async function listHistory(
  projectId: string,
  limit = 100,
  offset = 0,
): Promise<HistoryEntrySummary[]> {
  const db = await getDb();
  const rows = await db.select<HistorySummaryRow[]>(
    "SELECT id, project_id, request_id, method, url, status, duration_ms, error, created_at FROM history WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
    [projectId, limit, offset],
  );
  return rows.map(toSummary);
}

/** 按 id 查完整历史详情，不存在返回 null */
export async function getHistoryEntry(id: string): Promise<HistoryEntry | null> {
  const db = await getDb();
  const rows = await db.select<HistoryRow[]>(
    "SELECT * FROM history WHERE id = $1",
    [id],
  );
  return rows.length > 0 ? toEntry(rows[0]) : null;
}

/** 记录一次发送 */
export async function addHistory(input: AddHistoryInput): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    ...input,
    id: createId(),
    createdAt: Date.now(),
  };
  const db = await getDb();
  await db.execute(
    "INSERT INTO history (id, project_id, request_id, method, url, params, headers, body_type, body, status, duration_ms, response_headers, response_body, error, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [
      entry.id,
      entry.projectId,
      entry.requestId,
      entry.method,
      entry.url,
      JSON.stringify(entry.params),
      JSON.stringify(entry.headers),
      entry.bodyType,
      entry.body,
      entry.status,
      entry.durationMs,
      JSON.stringify(entry.responseHeaders),
      entry.responseBody,
      entry.error,
      entry.createdAt,
    ],
  );
  return entry;
}

/** 删除单条历史。不存在时抛错 */
export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM history WHERE id = $1", [id]);
  if (result.rowsAffected === 0) {
    throw new Error(`历史记录不存在: ${id}`);
  }
}

/** 清空项目下的全部历史 */
export async function clearHistory(projectId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM history WHERE project_id = $1", [projectId]);
}
