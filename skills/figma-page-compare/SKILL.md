---
name: figma-page-compare
description: >-
  用 chrome-browser-plugin 的 show_design_diffs，把 Figma 整页 Frame 与已钉住的
  Chrome 目标页做还原度/设计走查比对。仅当用户明确要求「比对设计稿与当前页面」「设计走查」
  「还原度检查」「设计差异」或调用 show_design_diffs 时使用。不要在「按 Figma 写/实现页面」
  「只看这个 Figma 链接」「设计稿落地/转代码」时启用。
---

# Figma ↔ 页面 MCP 比对

仅当用户要做 **Figma 设计稿与线上/本地页面还原度比对** 时启用。其它任务忽略。

依赖：

1. 本插件提供的 MCP（`chrome-browser-plugin` / `ping`、`get_target_tab`、`get_dom_snapshot` 等）
2. Figma MCP（`get_metadata` / `get_design_context` / `get_screenshot`）
3. 用户已安装并连接配套 Chrome 扩展（`ws://127.0.0.1:9527`）

## 闸门（必须按序；任一步失败则停止，用中文友好提示，禁止继续瞎比）

### 0. 是否带了 Figma link

- 用户消息里必须有 `figma.com/design/...`（或 `/file/`）链接。
- **没有 link**：停止，提示：

> 请先发送要比对的 Figma 节点链接（需带 `node-id`）。  
> 示例：`https://www.figma.com/design/<fileKey>/xxx?node-id=4356-7884`  
> 并在插件顶部点「设为 MCP 目标页」后，再说一次「比对」。

### 1. 解析 URL + 是否为「整页」节点

从 URL 取 `fileKey`、`nodeId`（`4356-7884` → `4356:7884`）。无 `node-id` 则停止，提示去 Dev Mode 选中**整页 Frame**再复制链接。

调用 Figma MCP `get_metadata`（或 `get_design_context`）看根节点，**整页**需同时满足：

1. 类型为 `frame` / `COMPONENT` / 整屏画板（不是单按钮、图标、小文本）。
2. 宽度约 **375**（允许 360–390）；高度通常 **≥ 600**（常见 812）。
3. 名称像页面（如含「开户」「上传」「验证」），而非 `按钮` / `icon` / `Rectangle`。

**不是整页**：停止，提示：

> 当前节点看起来不是整页（宽高/类型不符合手机整屏 Frame）。  
> 请在 Figma 左侧选中整页画板（约 375×812），再复制带 `node-id` 的链接发我。  
> 当前节点：`{name}` / `{w}×{h}` / `{type}`。

### 2. 两个 MCP 是否可用

必须同时可用：

| MCP | 用途 | 探活 |
|-----|------|------|
| `plugin-figma-figma`（或 Figma） | 设计稿 | `get_metadata` / `get_design_context` |
| `chrome-browser-plugin`（本插件 MCP，操控浏览器） | 页面 | `ping` 或 `get_target_tab` |

- Figma 不可用：提示检查 Cursor / VS Code MCP 里 Figma 已连接/授权。
- Chrome 扩展不可用 / `Chrome extension is not connected`：提示先启动本 MCP，再在 Chrome 刷新扩展，确认连上 `ws://127.0.0.1:9527`。
- 任一失败：**停止**，不要用臆测页面继续比。

### 3. Target Tab 是否已设置

调用 `get_target_tab`：

- `pinned !== true` 或没有 `target.tabId`：停止，提示：

> 还没有钉住 MCP 目标页。请打开要比对的业务页 → 扩展 Panel 顶部点「设为 MCP 目标页」→ 再让我比对。

- 已钉住：简短确认 `title` / `url` / `tabId` 后再往下。

### 4. Figma 与 Target 是否为同一屏

闸门 0–3 通过后，先做「是不是同一页」校验，**通过后再做细项比对**。

取两侧信号（可并行）：

| 侧 | 信号来源 | 用来判断的内容 |
|----|----------|----------------|
| Figma | `get_metadata` 根节点名 + `get_design_context` / `get_screenshot` | Frame 名、主标题、关键区块（如上传区、底栏双按钮） |
| Target | `screenshot_design_width` + `get_dom_snapshot` | 截图主结构、`textPreview` 锚点文案、主区块布局 |

**同一屏**需大致同时成立（文案仅作锚点，不要求字字相等）：

1. 页面主任务一致（例如都是「上传证件」，而不是一侧上传、一侧「请选择开户类型」）。
2. 关键结构对得上（如都有上传区 / 说明区 / 底栏按钮；不是完全不同的列表页 vs 表单页）。
3. DOM / 截图里能找到设计稿上的若干核心锚点（如「上传证件」「点击上传」「文件要求」），缺失大半则视为不是同一屏。

**不是同一屏**：停止，**不要**继续软匹配细项或臆造间距/颜色差异；可可选把「页面错位」推一条到 `show_design_diffs`，并提示：

> Figma 页面和 Target 的页面对不上。  
> 设计稿：`{figmaFrameName}`（`{nodeId}`）  
> 当前 Target：`{pageTitle或主文案锚点}`（`{url}`）  
> 请先打开与设计稿同一业务屏 → 扩展 Panel 顶部再点一次「设为 MCP 目标页」→ 再说「比对」。

## 比对链路（闸门 0–4 通过后严格按序）

1. `get_target_tab` — 再确认一次目标页  
2. `screenshot_design_width` — 保证 `offsetWidth === 375`；**保留返回的 `pngBase64`**（页面图）  
3. `get_dom_snapshot` — 几何/间距（gapBelow、gapRight）、宽高、padding/margin、圆角、边框、color、fontSize、lineHeight、fontWeight、opacity、disabled  
4. Figma：`get_screenshot`（整页 Frame）拿到设计稿图 + `get_design_context` / `get_metadata`（先读 figma-design-to-code skill）  
5. **同一屏复核**（闸门 4）：对不上则停止并提示，不进入细项比对  
6. AI 软匹配节点（文案仅作锚点；**不比对文字内容与 font-family**）  
7. `show_design_diffs` — **必须**带上：
   - `figmaImageBase64`：Figma `get_screenshot` 的图（base64 或 data URL）
   - `pageImageBase64`：步骤 2 的 `pngBase64`
   - `diffs`：属性差异数组
   - `figmaNodeId` / `figmaFileKey` / `pageUrl`（可选）
   
   调用后扩展会：**聚焦 MCP 目标页 + 自动打开比对弹窗**（`sl-image-comparer` 滑块对比 + 差异列表）。
8. **聊天输出（强制）**：
   - **禁止**在聊天里贴差异表格、大段 markdown table、或再贴两张对比图。
   - 只简短提示用户去插件查看，例如：

> 比对完成，已在扩展弹窗打开「Figma ↔ 页面」滑块对比与差异列表。  
> 请到弹出的比对窗口（或 Panel → 工具箱 → Figma 比对）查看；点击差异项可在目标页高亮对应节点。  
> 共 {n} 处属性差异。

## 比对范围

- **要比**：
  - 间距：`gapBelow` / `gapRight`、相对左右边距（常用 `rect.x≈16`）
  - 尺寸：`rect.w` / `rect.h`
  - 盒模型：`padding` / `margin`
  - 圆角：`borderRadius`
  - 边框：`border.width` / `border.color`
  - 颜色：文字 `color`、背景 `backgroundColor`
  - 字体度量：`fontWeight`、`fontSize`、`lineHeight`（不比 font-family）
  - 透明度：`opacity`
  - 禁用态：`state.disabled` 及对应禁用样式（如下一步灰底）
  - 关键布局错位（区块相对位置，用相对间距而非绝对 y）
- **不要比**：
  - 接口动态文案内容、font-family
  - 状态栏 / Home Indicator 等设备壳
  - 装饰图像素、box-shadow、letter-spacing
  - 绝对 `y`（页面有步骤条时与 Figma 坐标系易错位，应比相对间距）

## 禁止

- 跳过闸门直接截图或臆造差异  
- Target 未设置时用「当前激活 tab」凑合（除非用户明确说用激活 tab）  
- 对非整页小组件链接硬比一整页  
- Figma 与 Target 不是同一屏时仍做细项比对或编造还原度差异  
- 比对完成后在聊天里输出差异表格或重复贴图（结果以扩展弹窗为准）  
