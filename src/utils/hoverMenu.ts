import type { MouseEvent, SyntheticEvent } from "react";

/**
 * 同步悬停菜单位置（挂在 .workspace-more 容器的 onMouseEnter / onFocus 上）。
 * 菜单为 fixed 定位以跳出祖先滚动容器的裁剪，CSS 里只有 top:0 / left:0 占位，
 * 展开前必须按触发按钮的视口坐标写入 top / left；右对齐菜单按按钮右缘回推菜单宽度，
 * 同时把 stylesheet 里的 right:0 复位为 auto，否则 left/right 同时生效会把菜单横向拉满。
 * 注意在悬停展开生效前触发：此时菜单 visibility:hidden 但仍参与布局，offsetWidth 可测。
 */
export function positionHoverMenu(event: SyntheticEvent<HTMLElement>) {
  const root = event.currentTarget;
  const menu = root.querySelector<HTMLElement>(".workspace-more-menu");
  if (!menu) return;
  const rect = root.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = menu.classList.contains("workspace-more-menu-right")
    ? `${rect.right - menu.offsetWidth}px`
    : `${rect.left}px`;
  menu.style.right = "auto";
}

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
