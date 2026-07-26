/** 可配置的快捷键动作 */
export type ShortcutAction =
  | "newRequest"
  | "sendRequest"
  | "saveRequest"
  | "importCurl"
  | "newProject"
  | "closeTab"
  | "nextTab"
  | "prevTab"
  | "refresh"
  | "openSettings"
  | "globalSearch";

/** 快捷键配置，持久化在 localStorage */
export interface ShortcutConfig {
  /** 总开关：关闭后不再监听快捷键 */
  enabled: boolean;
  /** 动作 → 组合键（如 "meta+t"），空字符串表示未设置 */
  bindings: Record<ShortcutAction, string>;
}
