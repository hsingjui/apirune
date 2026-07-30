import type * as React from "react";

import { cn } from "@/lib/utils";

// 全局输入框统一为表格输入框风格（与 global.css 的 .request-params-row input 一致）：
// 常态即显示描边，聚焦中性描边 + 轻微投影。
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-(--c-border) bg-(--c-surface-high) px-[11px] text-[13px] transition-[background-color,border-color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[rgb(var(--gray-5))] focus-visible:bg-(--c-surface-high) focus-visible:shadow-(--shadow-subtle)",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
