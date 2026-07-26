/** 请求方法及其标识色（取自 Arco 色板，与项目图标用色一致） */
export const METHODS: { value: string; color: string }[] = [
  { value: "GET", color: "#00b42a" },
  { value: "POST", color: "#ff7d00" },
  { value: "PUT", color: "#165dff" },
  { value: "PATCH", color: "#722ed1" },
  { value: "DELETE", color: "#f53f3f" },
  { value: "HEAD", color: "#0fc6c2" },
  { value: "OPTIONS", color: "#86909c" },
];

/** 取方法标识色，未知方法用中性灰 */
export function getMethodColor(method: string): string {
  return METHODS.find((entry) => entry.value === method)?.color ?? "#86909c";
}
