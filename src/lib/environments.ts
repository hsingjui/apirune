import Database from "@tauri-apps/plugin-sql";
import { t } from "../i18n";
import type {
  Environment,
  EnvVariable,
  GlobalParam,
  ImportUrlRule,
  ProjectGlobals,
} from "../types/environment";
import type { AuthConfig } from "../types/http";
import { createId } from "../utils/id";

const DB_URI = "sqlite:apirune.db";

function getDb(): Promise<Database> {
  return Database.load(DB_URI);
}

/** 数据库行（snake_case、JSON 串）到前端模型的映射 */
type EnvironmentRow = {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  variables: string;
  auth: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toEnvironment(row: EnvironmentRow): Environment {
  const auth = parseJson<AuthConfig | null>(row.auth, null);
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    baseUrl: row.base_url,
    variables: parseJson<EnvVariable[]>(row.variables, []),
    auth: auth?.authType ? auth : undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 读取项目上次选中的环境 ID，未选择时返回 null */
export async function loadActiveEnvId(projectId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ active_env_id: string | null }[]>(
    "SELECT active_env_id FROM project_env_state WHERE project_id = $1",
    [projectId],
  );
  return rows[0]?.active_env_id ?? null;
}

/** 持久化项目选中的环境 ID（upsert）；传 null 表示清除选择 */
export async function saveActiveEnvId(projectId: string, envId: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO project_env_state (project_id, active_env_id, updated_at) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO UPDATE SET active_env_id = $2, updated_at = $3",
    [projectId, envId, Date.now()],
  );
}

/** 列出项目下全部环境，按 sortOrder 升序 */
export async function listEnvironments(projectId: string): Promise<Environment[]> {
  const db = await getDb();
  const rows = await db.select<EnvironmentRow[]>(
    "SELECT id, project_id, name, base_url, variables, auth, sort_order, created_at, updated_at FROM environments WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [projectId],
  );
  return rows.map(toEnvironment);
}

/** 全量保存项目环境：先清空再按顺序写入（本地单机场景，简单可靠） */
export async function replaceEnvironments(
  projectId: string,
  environments: Environment[],
): Promise<void> {
  const now = Date.now();
  const db = await getDb();
  await db.execute("DELETE FROM environments WHERE project_id = $1", [projectId]);
  for (const [index, env] of environments.entries()) {
    await db.execute(
      "INSERT INTO environments (id, project_id, name, base_url, variables, auth, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        env.id,
        projectId,
        env.name,
        env.baseUrl,
        JSON.stringify(env.variables),
        JSON.stringify(env.auth ?? {}),
        index,
        env.createdAt,
        now,
      ],
    );
  }
}

/** 新建项目时的默认环境：测试环境 + 正式环境（名称按创建时的界面语言写入） */
export async function createDefaultEnvironments(projectId: string): Promise<void> {
  const now = Date.now();
  const defaults = [t("env.defaultTest"), t("env.defaultProd")];
  const db = await getDb();
  for (const [index, name] of defaults.entries()) {
    await db.execute(
      "INSERT INTO environments (id, project_id, name, base_url, variables, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [createId(), projectId, name, "", "[]", index, now, now],
    );
  }
}

/** 读取项目全局变量 / 全局参数 / 导入 URL 规则，无记录时返回空配置 */
export async function getProjectGlobals(projectId: string): Promise<ProjectGlobals> {
  const db = await getDb();
  const rows = await db.select<{ variables: string; params: string; import_url_rules: string }[]>(
    "SELECT variables, params, import_url_rules FROM project_globals WHERE project_id = $1",
    [projectId],
  );
  if (rows.length === 0) return { variables: [], params: [], importUrlRules: [] };
  return {
    variables: parseJson<EnvVariable[]>(rows[0].variables, []),
    params: parseJson<GlobalParam[]>(rows[0].params, []),
    importUrlRules: parseJson<ImportUrlRule[]>(rows[0].import_url_rules, []),
  };
}

/** 保存项目全局变量 / 全局参数 / 导入 URL 规则（upsert） */
export async function saveProjectGlobals(
  projectId: string,
  globals: ProjectGlobals,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO project_globals (project_id, variables, params, import_url_rules, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id) DO UPDATE SET variables = $2, params = $3, import_url_rules = $4, updated_at = $5",
    [
      projectId,
      JSON.stringify(globals.variables),
      JSON.stringify(globals.params),
      JSON.stringify(globals.importUrlRules),
      Date.now(),
    ],
  );
}

/** 向指定环境写入单个变量（同名覆盖）；环境不存在时抛错 */
export async function upsertEnvVariable(envId: string, name: string, value: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ variables: string }[]>(
    "SELECT variables FROM environments WHERE id = $1",
    [envId],
  );
  if (rows.length === 0) throw new Error(`环境不存在: ${envId}`);
  const variables = parseJson<EnvVariable[]>(rows[0].variables, []);
  const existing = variables.find((item) => item.name === name);
  if (existing) existing.value = value;
  else variables.push({ name, value });
  await db.execute("UPDATE environments SET variables = $1, updated_at = $2 WHERE id = $3", [
    JSON.stringify(variables),
    Date.now(),
    envId,
  ]);
}

/** 向项目全局变量写入单个变量（同名覆盖） */
export async function upsertGlobalVariable(
  projectId: string,
  name: string,
  value: string,
): Promise<void> {
  const globals = await getProjectGlobals(projectId);
  const existing = globals.variables.find((item) => item.name === name);
  if (existing) existing.value = value;
  else globals.variables.push({ name, value });
  await saveProjectGlobals(projectId, globals);
}

/** 向项目全局参数写入单项；同类型同名参数覆盖，Header 名忽略大小写 */
export async function upsertGlobalParam(
  projectId: string,
  paramIn: GlobalParam["in"],
  name: string,
  value: string,
): Promise<void> {
  const globals = await getProjectGlobals(projectId);
  const existing = globals.params.find(
    (item) =>
      item.in === paramIn &&
      (paramIn === "header" ? item.name.toLowerCase() === name.toLowerCase() : item.name === name),
  );
  if (existing) {
    existing.name = name;
    existing.value = value;
  } else {
    globals.params.push({ in: paramIn, name, value });
  }
  await saveProjectGlobals(projectId, globals);
}

/** 删除项目时级联清理环境、全局配置与环境选择 */
export async function deleteEnvironmentData(projectId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM environments WHERE project_id = $1", [projectId]);
  await db.execute("DELETE FROM project_globals WHERE project_id = $1", [projectId]);
  await db.execute("DELETE FROM project_env_state WHERE project_id = $1", [projectId]);
}
