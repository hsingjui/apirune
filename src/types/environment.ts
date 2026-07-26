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

/** 项目级全局配置：全局变量与全局参数 */
export interface ProjectGlobals {
  variables: EnvVariable[];
  params: GlobalParam[];
}
