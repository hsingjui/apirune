#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)/"
TARGET_DIR="${TARGET_DIR:-/mnt/e/Code/apirune/}"
DEBOUNCE_SECONDS="${DEBOUNCE_SECONDS:-0.15}"

RSYNC_EXCLUDES=(
  "--exclude=.git/"
  "--exclude=.idea/"
  "--exclude=.vscode/"
  "--exclude=node_modules/"
  "--exclude=dist/"
  "--exclude=.vite/"
  "--exclude=target/"
)

INOTIFY_EXCLUDE='(^|/)(\.git|\.idea|\.vscode|node_modules|dist|\.vite|target)(/|$)'

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf '缺少依赖命令：%s\n' "$1" >&2
    exit 127
  }
}

sync_once() {
  mkdir -p -- "$TARGET_DIR"

  rsync \
    --archive \
    --delete-delay \
    --no-perms \
    --no-owner \
    --no-group \
    --omit-dir-times \
    "${RSYNC_EXCLUDES[@]}" \
    "$SOURCE_DIR" \
    "$TARGET_DIR"
}

require_command rsync
require_command inotifywait

# 先启动监听，以便首次同步期间发生的变更也会在后续事件中处理。
coproc WATCHER {
  inotifywait \
    --monitor \
    --quiet \
    --recursive \
    --event close_write,create,delete,move \
    --exclude "$INOTIFY_EXCLUDE" \
    --format '%w%f' \
    "$SOURCE_DIR"
}
WATCHER_PID="$WATCHER_PID"
WATCHER_READ_FD="${WATCHER[0]}"

cleanup() {
  if [[ -n "${WATCHER_PID:-}" ]]; then
    kill "$WATCHER_PID" 2>/dev/null || true
    wait "$WATCHER_PID" 2>/dev/null || true
  fi
  exec {WATCHER_READ_FD}<&- 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 0' INT TERM

printf '首次同步：%s -> %s\n' "$SOURCE_DIR" "$TARGET_DIR"
sync_once
printf '正在实时同步，按 Ctrl+C 停止。\n'

while true; do
  if ! IFS= read -r -u "$WATCHER_READ_FD"; then
    wait "$WATCHER_PID"
    exit 1
  fi

  # 在连续写入结束前持续收集事件，避免为一次保存重复执行同步。
  while IFS= read -r -t "$DEBOUNCE_SECONDS" -u "$WATCHER_READ_FD"; do
    :
  done

  sync_once
  printf '已同步：%(%F %T)T\n' -1
done
