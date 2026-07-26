/** 判断元素是否可编辑（输入框需要保留系统的剪切/复制/粘贴菜单） */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * 禁用 WebView 原生右键菜单（Reload / Inspect Element）。
 * 开发模式保留，方便调试；输入类元素保留，避免影响复制粘贴。
 */
export function setupContextMenu(): void {
  if (import.meta.env.DEV) return;
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (isEditable(event.target)) return;
      event.preventDefault();
    },
    { capture: true },
  );
}
