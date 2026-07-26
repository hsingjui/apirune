import { invoke } from "@tauri-apps/api/core";

/** 读取本地文本文件内容；Rust 侧限制 20 MB，非 UTF-8 文本时报错 */
export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}
