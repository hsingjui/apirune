---
kind: issue
title: "URL 地址栏粘贴 Query 参数识别"
type: ff
status: closed
created: 2026-07-29
epic: ""
---

# URL 地址栏粘贴 Query 参数识别

## 做了什么

在请求编辑器的 URL 地址栏粘贴包含 query string 的地址时，自动移除地址栏中的 query，并写入 Params 页签。保留重复键、空值和 hash；没有 query 的粘贴维持原有行为。

## 改了哪些

- `src/components/RequestEditor.tsx` — 添加粘贴 URL 的 query 解析与 Params 同步。

## 怎么验证的

`pnpm exec tsc --noEmit` 通过；`git diff --check` 通过。未运行自动化测试（项目约束）。

## 对 codestable/ 的影响

无影响。
