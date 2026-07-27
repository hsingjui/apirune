import Database from "@tauri-apps/plugin-sql";
import type { CreateProjectInput, Project, ProjectStats } from "../types/project";
import { createId } from "../utils/id";
import { createDefaultEnvironments, deleteEnvironmentData } from "./environments";
import { deleteQuickData } from "./quickRequests";
import { deleteProjectData } from "./requests";

/**
 * SQLite 连接字符串。路径相对于 `tauri::path::BaseDirectory::AppConfig`，
 * 建表 migration 在 Rust 侧 `tauri_plugin_sql` 注册，load 时自动执行。
 */
const DB_URI = "sqlite:apirune.db";

/** 内置快速请求项目的固定 id：不在主页网格展示，供免建项目直接发请求 */
export const SCRATCH_PROJECT_ID = "__scratch__";

/** 数据库行（snake_case）到前端模型（camelCase）的映射 */
type ProjectRow = {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 取排在末尾的下一个排序值 */
async function nextSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ next: number }[]>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM projects",
  );
  return rows[0]?.next ?? 0;
}

function getDb(): Promise<Database> {
  return Database.load(DB_URI);
}

/** 列出全部项目，按手动排序位次升序 */
export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, icon, sort_order, created_at, updated_at FROM projects ORDER BY sort_order ASC, created_at DESC, id DESC",
  );
  return rows.map(toProject);
}

/** 按给定 id 顺序重排项目，未列出的项目排序值保持不变 */
export async function reorderProjects(ids: string[]): Promise<void> {
  const db = await getDb();
  for (let index = 0; index < ids.length; index++) {
    await db.execute("UPDATE projects SET sort_order = $1 WHERE id = $2", [index, ids[index]]);
  }
}

/** 按 id 查单个项目，不存在返回 null */
export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, icon, sort_order, created_at, updated_at FROM projects WHERE id = $1",
    [id],
  );
  return rows.length > 0 ? toProject(rows[0]) : null;
}

type MethodCountRow = { project_id: string; method: string; count: number };
type EnvNameRow = { project_id: string; name: string };
type LastSentRow = { project_id: string; last_sent_at: number };

/** 各项目的请求方法分布、环境名与最后发送时间，键为项目 id */
export async function listProjectStats(): Promise<Record<string, ProjectStats>> {
  const db = await getDb();
  const [methodRows, envRows, lastSentRows] = await Promise.all([
    db.select<MethodCountRow[]>(
      "SELECT project_id, method, COUNT(*) AS count FROM history GROUP BY project_id, method",
    ),
    db.select<EnvNameRow[]>(
      "SELECT project_id, name FROM environments ORDER BY sort_order ASC, created_at ASC",
    ),
    db.select<LastSentRow[]>(
      "SELECT project_id, MAX(created_at) AS last_sent_at FROM history GROUP BY project_id",
    ),
  ]);
  const stats: Record<string, ProjectStats> = {};
  const ensure = (projectId: string) =>
    (stats[projectId] ??= { methodCounts: {}, environmentNames: [], lastSentAt: null });
  for (const row of methodRows) {
    ensure(row.project_id).methodCounts[row.method] = row.count;
  }
  for (const row of envRows) {
    ensure(row.project_id).environmentNames.push(row.name);
  }
  for (const row of lastSentRows) {
    if (row.last_sent_at != null) ensure(row.project_id).lastSentAt = row.last_sent_at;
  }
  return stats;
}

/** 确保内置快速请求项目存在（首次使用时创建），返回该项目 */
export async function ensureScratchProject(name: string): Promise<Project> {
  const existing = await getProject(SCRATCH_PROJECT_ID);
  if (existing) return existing;
  const now = Date.now();
  const db = await getDb();
  const project: Project = {
    id: SCRATCH_PROJECT_ID,
    name,
    icon: "thunderbolt",
    sortOrder: await nextSortOrder(db),
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    "INSERT INTO projects (id, name, icon, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      project.id,
      project.name,
      project.icon,
      project.sortOrder,
      project.createdAt,
      project.updatedAt,
    ],
  );
  await createDefaultEnvironments(project.id);
  return project;
}

/** 新建项目，id 与两个时间戳在此生成，排序默认追加到末尾 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const now = Date.now();
  const db = await getDb();
  const project: Project = {
    id: createId(),
    name: input.name,
    icon: input.icon,
    sortOrder: await nextSortOrder(db),
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    "INSERT INTO projects (id, name, icon, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      project.id,
      project.name,
      project.icon,
      project.sortOrder,
      project.createdAt,
      project.updatedAt,
    ],
  );
  // 新项目默认附带「测试环境」与「正式环境」
  await createDefaultEnvironments(project.id);
  return project;
}

/** 更新项目名称与图标，自动刷新 updatedAt。项目不存在时抛错 */
export async function updateProject(id: string, input: CreateProjectInput): Promise<Project> {
  const now = Date.now();
  const db = await getDb();
  const result = await db.execute(
    "UPDATE projects SET name = $1, icon = $2, updated_at = $3 WHERE id = $4",
    [input.name, input.icon, now, id],
  );
  if (result.rowsAffected === 0) {
    throw new Error(`项目不存在: ${id}`);
  }
  const updated = await getProject(id);
  if (!updated) {
    throw new Error(`更新后未找到项目: ${id}`);
  }
  return updated;
}

/** 删除项目，并级联清理其下的目录与请求。项目不存在时抛错 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM projects WHERE id = $1", [id]);
  if (result.rowsAffected === 0) {
    throw new Error(`项目不存在: ${id}`);
  }
  await deleteProjectData(id);
  await deleteQuickData(id);
  await deleteEnvironmentData(id);
}
