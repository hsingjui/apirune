import type { MouseEvent } from "react";

/**
 * 点击悬停菜单项后临时关闭菜单（挂在 .workspace-more-menu 容器的 onClick 上）。
 * 菜单靠 CSS :hover / :focus-within 展开，点击后鼠标仍悬停会导致菜单不消失；
 * 这里给容器加 workspace-more-closed 强制隐藏，鼠标移出后移除以恢复悬停展开。
 */
export function closeHoverMenu(event: MouseEvent) {
  const root = (event.target as HTMLElement).closest<HTMLElement>(".workspace-more");
  if (!root) return;
  root.classList.add("workspace-more-closed");
  root.addEventListener("mouseleave", () => root.classList.remove("workspace-more-closed"), {
    once: true,
  });
  // 清除焦点，避免 :focus-within 让菜单保持展开
  (document.activeElement as HTMLElement | null)?.blur();
}
