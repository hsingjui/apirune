/** 请求方法及其标识色：低饱和暖调，色值令牌在 global.css 按主题定义 */
export const METHODS: { value: string; color: string }[] = [
  { value: "GET", color: "var(--method-get)" },
  { value: "POST", color: "var(--method-post)" },
  { value: "PUT", color: "var(--method-put)" },
  { value: "PATCH", color: "var(--method-patch)" },
  { value: "DELETE", color: "var(--method-delete)" },
  { value: "HEAD", color: "var(--method-head)" },
  { value: "OPTIONS", color: "var(--method-options)" },
];

/** 取方法标识色，未知方法用中性灰 */
export function getMethodColor(method: string): string {
  return METHODS.find((entry) => entry.value === method)?.color ?? "var(--c-ink-tertiary)";
}
