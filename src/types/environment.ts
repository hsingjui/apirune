import type { AuthConfig } from "./http";

/** 环境变量 / 全局变量条目 */
export interface EnvVariable {
  name: string;
  value: string;
}

/** 全局参数注入位置 */
export type GlobalParamIn = "header" | "cookie" | "query";

/** 全局参数条目：发送请求时按位置附加到每个请求 */
export interface GlobalParam {
  in: GlobalParamIn;
  name: string;
  value: string;
  /** 是否参与发送；缺省视为启用 */
  enabled?: boolean;
}

/** 项目环境：前置 URL + 环境变量 */
export interface Environment {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  variables: EnvVariable[];
  /** 环境级鉴权，发送时自动附加；请求头 / 参数已有同名项时以请求为准 */
  auth?: AuthConfig;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 导入 URL 规则：命中第一条即改写导入请求的 URL */
export interface ImportUrlRule {
  /** 匹配内容；regex 为 false 时按 URL 前缀匹配，为 true 时作为正则 */
  match: string;
  /** 替换结果；正则模式支持 $1 等分组引用 */
  replace: string;
  /** 是否将 match 视为正则表达式 */
  regex: boolean;
}

/** 项目级全局配置：全局变量、全局参数与导入 URL 规则 */
export interface ProjectGlobals {
  variables: EnvVariable[];
  params: GlobalParam[];
  /** 导入请求时按顺序应用的 URL 改写规则，第一条命中即停 */
  importUrlRules: ImportUrlRule[];
}
