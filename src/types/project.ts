export interface Project {
  id: string;
  name: string;
  /** 内置图标 key，见 constants/projectIcons.ts */
  icon: string;
  /** 手动排序位次，升序排列 */
  sortOrder: number;
  createdAt: number;
  /** 最后修改时间，由后端在创建/更新时写入 */
  updatedAt: number;
}

/** 项目统计信息，用于主页卡片展示 */
export interface ProjectStats {
  /** 各请求方法的接口数 */
  methodCounts: Record<string, number>;
  /** 环境名列表，按排序值排列 */
  environmentNames: string[];
}

export interface CreateProjectInput {
  name: string;
  icon: string;
}
