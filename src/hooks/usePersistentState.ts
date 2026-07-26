import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** 与 useState 行为一致，但将值持久化到 localStorage */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储失败（如配额不足）不影响使用
    }
  }, [key, value]);

  return [value, setValue];
}
