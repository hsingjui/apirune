export interface Project {
  id: string;
  name: string;
  /** 内置图标 key，见 constants/projectIcons.ts */
  icon: string;
  createdAt: number;
  /** 最后修改时间，由后端在创建/更新时写入 */
  updatedAt: number;
}

export interface CreateProjectInput {
  name: string;
  icon: string;
}
