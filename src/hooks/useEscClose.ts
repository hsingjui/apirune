import { useEffect, useRef } from "react";

/**
 * 当 visible 为 true 时，在捕获阶段监听 Escape 键并调用 handler。
 *
 * 使用 window 捕获阶段而非依赖弹窗内部焦点，确保即使焦点落到遮罩或 body
 * 时也能响应 ESC；stopPropagation 避免与组件内部按键处理重复触发。
 */
export function useEscClose(visible: boolean, handler: () => void) {
  // handler 每次渲染都可能变化，用 ref 缓存最新引用，effect 只依赖 visible
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handlerRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [visible]);
}
