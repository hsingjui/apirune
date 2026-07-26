import { useEffect, useRef } from "react";
import {
  comboFromEvent,
  isShortcutRecording,
  loadShortcuts,
  SHORTCUT_EVENT,
} from "../lib/shortcuts";
import type { ShortcutAction } from "../types/shortcuts";

/** 快捷键事件：gotoTab 为固定的 ⌘1–⌘9 跳转，index 即数字键 */
export interface ShortcutEventDetail {
  action: ShortcutAction | "gotoTab";
  index?: number;
}

function dispatch(detail: ShortcutEventDetail) {
  window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT, { detail }));
}

/**
 * 全局键盘监听，在 App 挂载一次。
 * 基于窗口 keydown 实现：应用在前台（窗口聚焦）时才会收到事件，无需系统级快捷键。
 */
export function useShortcutListener() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutRecording()) return;
      const config = loadShortcuts();
      if (!config.enabled) return;
      const combo = comboFromEvent(event);
      if (combo == null) return;
      // 焦点在 CodeMirror 编辑器内时，⌘F / ⌘R 让给编辑器的查找替换，不触发全局动作
      if (
        (combo === "meta+f" || combo === "meta+r") &&
        (event.target as HTMLElement | null)?.closest?.(".cm-editor")
      ) {
        return;
      }
      // 固定快捷键：⌘1–⌘8 跳转到对应标签页，⌘9 跳转到最后一个
      const digit = /^meta\+([1-9])$/.exec(combo);
      if (digit) {
        event.preventDefault();
        dispatch({ action: "gotoTab", index: Number(digit[1]) });
        return;
      }
      const entry = (Object.entries(config.bindings) as [ShortcutAction, string][]).find(
        ([, bound]) => bound !== "" && bound === combo,
      );
      if (!entry) return;
      event.preventDefault();
      dispatch({ action: entry[0] });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

// closeTab 拦截器：工作区有快捷请求标签打开时优先关闭标签，而非关闭项目。
// 同一时刻只有激活项目的工作区挂载，单个槽位即可。
let closeTabInterceptor: (() => boolean) | null = null;

/** 注册 closeTab 拦截器；返回 true 表示已消费本次 closeTab */
export function useCloseTabInterceptor(handler: () => boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    closeTabInterceptor = () => ref.current();
    return () => {
      closeTabInterceptor = null;
    };
  }, []);
}

/** 执行 closeTab 拦截器，无拦截器时返回 false */
export const runCloseTabInterceptor = () => closeTabInterceptor?.() ?? false;

/** 订阅某个快捷键动作，handler 始终取最新闭包 */
export function useShortcutAction(
  action: ShortcutAction | "gotoTab",
  handler: (index?: number) => void,
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onShortcut = (event: Event) => {
      const detail = (event as CustomEvent<ShortcutEventDetail>).detail;
      if (detail.action === action) ref.current(detail.index);
    };
    window.addEventListener(SHORTCUT_EVENT, onShortcut);
    return () => window.removeEventListener(SHORTCUT_EVENT, onShortcut);
  }, [action]);
}
