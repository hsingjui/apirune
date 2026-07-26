import Database from "@tauri-apps/plugin-sql";
import type { CreateProjectInput, Project } from "../types/project";
import { createId } from "../utils/id";

/**
 * SQLite 连接字符串。路径相对于 `tauri::path::BaseDirectory::AppConfig`，
 * 建表 migration 在 Rust 侧 `tauri_plugin_sql` 注册，load 时自动执行。
 */
const DB_URI = "sqlite:apirune.db";

/** 数据库行（snake_case）到前端模型（camelCase）的映射 */
type ProjectRow = {
  id: string;
  name: string;
  icon: string;
  created_at: number;
  updated_at: number;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDb(): Promise<Database> {
  return Database.load(DB_URI);
}

/** 列出全部项目，按创建时间倒序 */
export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, icon, created_at, updated_at FROM projects ORDER BY created_at DESC, id DESC",
  );
  return rows.map(toProject);
}

/** 按 id 查单个项目，不存在返回 null */
export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, icon, created_at, updated_at FROM projects WHERE id = $1",
    [id],
  );
  return rows.length > 0 ? toProject(rows[0]) : null;
}

/** 新建项目，id 与两个时间戳在此生成 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: createId(),
    name: input.name,
    icon: input.icon,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.execute(
    "INSERT INTO projects (id, name, icon, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [project.id, project.name, project.icon, project.createdAt, project.updatedAt],
  );
  return project;
}

/** 更新项目名称与图标，自动刷新 updatedAt。项目不存在时抛错 */
export async function updateProject(
  id: string,
  input: CreateProjectInput,
): Promise<Project> {
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

/** 删除项目。项目不存在时抛错 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM projects WHERE id = $1", [id]);
  if (result.rowsAffected === 0) {
    throw new Error(`项目不存在: ${id}`);
  }
}
