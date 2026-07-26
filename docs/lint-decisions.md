# Lint 规则决策记录

记录 `biome.json` 中偏离 Biome 推荐预设的规则，以及背后的核查依据。
`biome.json` 是严格 JSON、不支持注释，故单独成文。

## 已修复并提升为 `error`

这些问题已在代码中真正解决，规则保持严格以拦截新增问题。

| 规则 | 原问题 | 修复方式 |
| --- | --- | --- |
| `noLabelWithoutControl` | 10 处 `<label>` 依赖隐式包裹关联 Radix 组件，依赖内部渲染结构，脆弱 | 改为 `useId()` 生成的显式 `id` + `htmlFor` 关联（`EnvironmentModal`、`SettingsModal`） |
| `noNoninteractiveElementToInteractiveRole` | 5 处 `<nav role="tablist">` 使导航地标语义被覆盖；1 处 `<b role="button">` | `nav` → `div`；`<b>` → 原生 `<button>` 并补 CSS reset |
| `useFocusableInteractive` | 搜索弹窗缺少 combobox 关联，屏幕阅读器读不出当前高亮项 | 补 `role="combobox"` + `aria-controls` + `aria-activedescendant`（`GlobalSearchModal`、`HomeSearchModal`） |

## 关闭的规则

以下规则已逐处核查，在本项目的 UI 模式下均为误报，强行"修复"会降低代码质量。

### `useSemanticElements` — off

12 处告警分两类，都不应改：

- **7 处 `role="button"` 的卡片/树节点**：内部嵌套了操作按钮（项目卡片有 2 个按钮，`ApiTree` 行内有菜单按钮）。外层改成 `<button>` 会产生**非法的按钮嵌套**，破坏点击行为与屏幕阅读器解析。
- **6 处 `role="radio"`**：已经写在真 `<button>` 上，外层有 `role="radiogroup"`，并带 `aria-checked` —— 这正是 W3C ARIA 推荐的 radio group 模式。换成 `<input type="radio">` 会破坏自定义分段控件的视觉。

### `noStaticElementInteractions` / `useKeyWithClickEvents` — off

| 模式 | 位置 | 说明 |
| --- | --- | --- |
| `onClick={stopPropagation}` 包装层 | `ApiTree` | 内部已有真 `<button>`，加 `tabIndex` 只会多出无用的 tab 停靠点 |
| `role="menu"` + 点击关闭 | `ApiTree`、`ProjectWorkspace` | `menuitem` 是真 `<button>`，Enter 触发 click 后冒泡，键盘本就可用 |
| `onContextMenu` 右键菜单 | `RequestEditor` | 鼠标专属交互，无键盘等价物 |
| 遮罩层 `onMouseDown` | `RequestEditor` | 点击外部关闭，Esc 另有处理 |

### `noDescendingSpecificity` — off

10 处告警中，低特异性选择器与高特异性选择器的**属性无交集**，不存在实际覆盖问题：

- `.request-panel-flush .request-body` 设 `flex`/`min-height`，`.request-body` 设 `display`/`flex-direction`/`gap`
- `[data-theme="dark"] body` 设 `--gray-*`，`body` 设 `--border-radius-*`

该规则只看选择器顺序、不看属性是否重叠。消除它需要重排约 1600 行 CSS，风险大于收益。

## 降级为 `warn`

### `noArrayIndexKey`

14 处全部核查后确认**当前均无实际风险**，保持 `warn` 仅作为未来的提醒。

- 10 处为只读列表（代码高亮行、快捷键展示、徽章、`ui/slider` 的固定 thumb、只追加不删除的 WS 消息），index 天然稳定。
- 4 处为可增删的键值表格（`EnvironmentModal`、`RequestEditor` 的 `KeyValueTable`）。曾担心"删除中间行导致输入框焦点错位"，但核查后确认：**删除行只有按钮 `onClick` 一条入口**（批量删除、单行删除），触发时焦点在按钮上而非 input，按钮又随行消失，因此该场景不存在。input 完全受控，数据也不会错乱。

**保持 `warn` 的原因**：一旦将来给这些表格加入拖拽排序，index 作为 key 就会变成真实缺陷，届时需要给 `FormRow` 引入稳定 id。当前 `params` 以 `JSON.stringify` 存入 SQLite，加 id 会影响存储格式，因此在没有实际需求前不做重构。

## 逐处抑制（`biome-ignore`）

### `useExhaustiveDependencies`

项目中原有 5 处 `eslint-disable`（但从未安装 ESLint，注释一直无效），已全部改为 `biome-ignore` 并补真实理由。

需要特别注意的是"多余依赖"类告警 —— 以下位置是**故意将依赖用作触发器**，删除会直接造成功能缺陷：

| 位置 | 依赖 | 作用 |
| --- | --- | --- |
| `GlobalSearchModal` / `HomeSearchModal` | `keyword` | 搜索词变化时重置选中项 |
| `Home` | `projects` | 项目变化时刷新统计 |
| `RequestEditor` | `events.length` | 新事件时滚动到底部 |
| `WsEditor` | `messages` | 新消息时滚动到底部 |

因此**不要**对本项目使用 `biome check --write --unsafe`。

另有 `SettingsModal` 中 `applyAppearance(settings)` 一处：该函数签名为 `Pick<AppSettings, "theme" | "uiFont" | "monoFont">`，依赖数组本就完整，Biome 无法跨函数边界推断。

### `noImportantStyles`

`global.css` 中 `prefers-reduced-motion` 的 3 处 `!important` 是标准无障碍降级写法，需要覆盖所有组件的动画定义，移除会使该功能失效。
