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
2. Figma MCP（`get_metadata` / `get_screenshot`；细节不够时再按需 `get_design_context`）
3. 用户已安装并连接配套 Chrome 扩展（`ws://127.0.0.1:9527`）

**不要**为比对去读 / 启用 `figma-design-to-code`（那是设计稿落地写代码用的）。

## 闸门（必须按序；任一步失败则停止，用中文友好提示，禁止继续瞎比）

### 0. 是否带了 Figma link

- 用户消息里必须有 `figma.com/design/...`（或 `/file/`）链接。
- **没有 link**：停止，提示：

> 请先发送要比对的 Figma 节点链接（需带 `node-id`）。  
> 示例：`https://www.figma.com/design/<fileKey>/xxx?node-id=4356-7884`  
> 并在插件顶部点「设为 MCP 目标页」后，再说一次「比对」。

### 1. 解析 URL + 是否为「整页」节点

从 URL 取 `fileKey`、`nodeId`（`4356-7884` → `4356:7884`）。无 `node-id` 则停止，提示去 Dev Mode 选中**整页 Frame**再复制链接。

调用 Figma MCP `get_metadata` 看根节点，**整页**需同时满足：

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
| `plugin-figma-figma`（或 Figma） | 设计稿 | `get_metadata` |
| `chrome-browser-plugin`（本插件 MCP，操控浏览器） | 页面 | `ping` 或 `get_target_tab` |

- Figma 不可用：提示检查 Cursor / VS Code MCP 里 Figma 已连接/授权。
- Chrome 扩展不可用 / `Chrome extension is not connected`：提示先启动本 MCP，再在 Chrome 刷新扩展，确认连上 `ws://127.0.0.1:9527`。
- 任一失败：**停止**，不要用臆测页面继续比。
- 调用 `show_design_diffs` 前用 `GetMcpTools` 看当次 schema 接受哪些字段，**以当次 schema 为准**，不要死记旧描述。

### 3. Target Tab 是否已设置

调用 `get_target_tab`：

- `pinned !== true` 或没有 `target.tabId`：停止，提示：

> 还没有钉住 MCP 目标页。请打开要比对的业务页 → 扩展 Panel 顶部点「设为 MCP 目标页」→ 再让我比对。

- 已钉住：简短确认 `title` / `url` / `tabId` 后再往下。

### 4. Figma 与 Target 是否为同一屏

闸门 0–3 通过后，先取两侧信号再做「是不是同一页」校验，**通过后再做细项比对**。

取两侧信号（可并行）：

| 侧 | 信号来源 | 用来判断的内容 |
|----|----------|----------------|
| Figma | `get_metadata` 根节点名 + `get_design_context` / `get_screenshot` | Frame 名、主标题、关键区块（如上传区、底栏双按钮） |
| Target | `screenshot_design_width` + `get_dom_snapshot` | 截图主结构、`textPreview` 锚点文案、主区块布局 |

**同一屏**需大致同时成立（文案仅作锚点，不要求字字相等）：

1. 页面主任务一致（例如都是「上传证件」，而不是一侧上传、一侧「请选择开户类型」）。
2. 关键结构对得上（如都有上传区 / 说明区 / 底栏按钮；不是完全不同的列表页 vs 表单页）。
3. DOM / 截图里能找到设计稿上的若干核心锚点（如「上传证件」「点击上传」「文件要求」），缺失大半则视为不是同一屏。

**不是同一屏**：停止，**不要**继续软匹配细项或臆造间距/颜色差异；**不要**调用 `show_design_diffs`（中途推 1 条再推完整列表会导致比对窗差异数跳动），只在聊天里提示：

> Figma 页面和 Target 的页面对不上。  
> 设计稿：`{figmaFrameName}`（`{nodeId}`）  
> 当前 Target：`{pageTitle或主文案锚点}`（`{url}`）  
> 请先打开与设计稿同一业务屏 → 扩展 Panel 顶部再点一次「设为 MCP 目标页」→ 再说「比对」。

## 比对链路（闸门 0–3 通过后；同一屏在取完信号后校验）

闸门 3 已确认目标页，**不必再调一次** `get_target_tab`。

1. `screenshot_design_width` — 保证 `offsetWidth === 375`；**页面完整截图缓存在扩展内**（返回里的 `pngBase64` 可能截断，仅供预览，**禁止再回传**）
2. `get_dom_snapshot` — **放在**截图之后；取 gapBelow/gapRight、宽高、padding/margin、圆角、边框、color、fontSize、lineHeight、fontWeight、opacity、disabled
3. Figma：`get_screenshot`（整页 Frame）拿到设计稿图 + `get_metadata`（闸门 1 可复用）；颜色/字号不够时再按需 `get_design_context`（**不要**为此读 design-to-code skill）  
   步骤 1–3 可与 Figma 侧并行
4. **同一屏校验**（闸门 4）：用上表信号判断；对不上则停止并提示，不进入细项比对、不调 `show_design_diffs`
5. AI 软匹配节点（文案仅作锚点；**不比对文字内容与 font-family**；**不比对选项卡/列表当前选中哪一项**，见「交互选中态」）
6. 按「容差 / 去重 / gap 规则」过滤后生成 `diffs`
7. `show_design_diffs` — **整次比对只调用一次**（禁止先推 1 条再推完整列表）

### `show_design_diffs` 入参（强制）

调用前确认当次 schema。入参规则：

1. **Figma 图（必须成功带上）**
   - **首选**：把 Figma `get_screenshot` 返回的 **https URL** 写入 `figmaImageBase64`（扩展 `parseImageInput` 支持 URL；比回传大包 base64 更稳）
   - 若当次 schema **明确有** `figmaImageUrl`：可与上一行双写同一 URL
   - **禁止**默认 `curl` 下载再塞整段 base64（除非 URL 方案失败）
   - **禁止**传 `pageImageBase64`（页面图用步骤 1 扩展缓存）
2. `diffs`：属性差异数组（见格式与去重）
3. 可选：`figmaNodeId` / `figmaFileKey` / `pageUrl`

调用后**必须**检查返回：

- `hasFigmaImage !== true` → **立刻重试**（换 URL→`figmaImageBase64` 或真正 base64），禁止当成功收工
- `hasPageImage !== true` → 先补调 `screenshot_design_width` 再重试 `show_design_diffs`
- 成功时扩展会在 **Panel 内用 `sl-dialog`** 打开「Figma ↔ 页面比对」，不开浏览器新窗口、不进工具箱

### 聊天输出（强制）

- **禁止**在聊天里贴差异表格、大段 markdown table、或再贴两张对比图。
- `{n}` = **`diffs` 数组长度**（差异节点条数，不是 issues 总数）。
- 只简短提示，例如：

> 比对完成，已在扩展 Panel 打开「Figma ↔ 页面比对」对话框。  
> 请查看滑块对比与差异列表；悬停差异项可在目标页高亮对应节点。  
> 共 {n} 处差异。

- 若当前选中项与设计稿示意不同：最多一句带过「属交互态，未计入差异」。

## 比对范围

推送到 `show_design_diffs` 时，`issues[].prop` **必须用中文**（见下表），不要写英文 CSS 属性名。

- **要比**（括号内为内部对照，勿写入 diffs）：
  - 下方间距（`gapBelow`）/ 右侧间距（`gapRight`）/ 左边距（`rect.x`）
  - 宽度（`rect.w`）/ 高度（`rect.h`）
  - 内边距（`padding`）/ 外边距（`margin`）
  - 圆角（`borderRadius`）
  - 边框宽度（`border.width`）/ 边框颜色（`border.color`）（**仅同一交互态**；见「交互选中态」）
  - 文字颜色（`color`）/ 背景色（`backgroundColor`）——先归一 6 位 hex 再比；**写入 diffs 时按下方「颜色变量」规则**
  - 字重（`fontWeight`）/ 字号（`fontSize`）/ 行高（`lineHeight`）（不比 font-family）
  - 透明度（`opacity`）
  - 禁用态（`state.disabled`）及禁用样式（如下一步灰底）——须在协议勾选等表单完成态与设计稿一致时再比；不是「选中了哪一项」
  - 关键布局错位（用相对间距，不用绝对 `y`）
  - **结构缺失**（`presence`）：设计稿有、页面 DOM 对应块整段不存在 → 可报；**不要**比文案对错，只报「块在不在」
- **不要比**：
  - 接口动态文案内容、font-family
  - 状态栏 / Home Indicator 等设备壳（Figma 常含 88px 顶栏，页面内容区可能没有——**禁止用绝对 Y 对齐**）
  - 装饰图像素、box-shadow、letter-spacing
  - 绝对 `y`
  - **交互选中态 / 展开态**（见下一节）

### 颜色变量（强制）

同目录 [`fsw-tokens.css`](./fsw-tokens.css) 为设计 token。比对颜色并写入 `issues` 时：

1. 把两侧颜色归一成小写 6 位 hex（`#rgb` → `#rrggbb`；`transparent` / `#00000000` / `rgba(0,0,0,0)` 等价）。
2. 在 `fsw-tokens.css` 的 `--fsw-palette-*` / `--fsw-color-*` 里查找**同 hex** 的变量。
3. **命中**：`actual` / `expected` 写变量名，如 `--fsw-palette-neutral300`（可带 `var(...)` 亦可只写变量名，全文统一一种）。
4. **未命中**：才写 Figma/页面原始 hex（如 `#87ceeb`）。
5. 优先用 semantic（`--fsw-color-*`）若与 palette 同色；无 semantic 再用 palette。

### gap / 坐标规则

- `gapBelow` / `gapRight` **仅使用 > 0** 的值（真兄弟间距）。
- `gapBelow < 0` 或异常大负数：表示重叠/父子包含，**忽略，禁止写入 diffs**。
- 页面 `rect` 相对设计宽度视口；注意父级 `padding` 对 `rect.x` 的影响，不要和 Figma 画板绝对坐标硬减。

### 容差（低于此不报）

| 属性 | 忽略条件 |
|------|----------|
| 间距 / 尺寸（px） | 差值绝对值 **≤ 1** |
| `lineHeight` | 先四舍五入到整数再比，或差值 **≤ 1** |
| `fontSize` | 差值 **≤ 0.5** |
| `borderRadius` | 差值 **≤ 1**；或两侧都已是「全圆角胶囊」（如 44 高按钮上 `48` vs `999`）→ 不报 |
| 颜色 | 归一 6 位 hex 后不同才报；`transparent` / `#00000000` / `rgba(0,0,0,0)` 视为等价 |
| `fontWeight` | Figma `Regular→400`、`Medium→500`、`Semibold→600`、`Bold→700`；**差不足一档**不报 |

### 同类差异去重

同一模式（如所有卡片 icon 都是 `20→24`、所有标题 `600→500`）：

- **最多报 1～2 个代表节点**
- 在该条 `issues` 或节点上加 `note`：`同类共 N 处`
- 禁止三条卡片各抄一遍刷屏

### `prop` 中文名（推送必须用）

| 内部键 | 推送用 `prop` |
|--------|----------------|
| `gapBelow` | 下方间距 |
| `gapRight` | 右侧间距 |
| `rect.x` | 左边距 |
| `rect.w` | 宽度 |
| `rect.h` | 高度 |
| `padding` | 内边距 |
| `margin` | 外边距 |
| `borderRadius` | 圆角 |
| `border.width` | 边框宽度 |
| `border.color` | 边框颜色 |
| `color` | 文字颜色 |
| `backgroundColor` | 背景色 |
| `fontWeight` | 字重 |
| `fontSize` | 字号 |
| `lineHeight` | 行高 |
| `opacity` | 透明度 |
| `state.disabled` | 禁用态 |
| `presence` | 是否存在 |

### `diffs` 条目格式

```json
{
  "selector": "h2",
  "figmaNodeId": "7559:44403",
  "figmaName": "选择开户证件类型",
  "note": "可选；同类共 N 处时写明",
  "issues": [
    { "prop": "文字颜色", "actual": "--fsw-palette-danger50", "expected": "--fsw-color-text-disabled" },
    { "prop": "左边距", "actual": 16, "expected": 24, "unit": "px" }
  ]
}
```

结构缺失示例：`issues: [{ "prop": "是否存在", "actual": "缺失", "expected": "存在" }]`（不要自造 `selectedState`）。

## 交互选中态（强制：禁止当还原度错误）

设计稿是**某一时刻的静态示意**（例如示意「网上转账开户」选中并展开材料说明）；页面上用户可能选了另一项（如「CA见证开户」）。  
这是**运行时交互状态不同**，不是实现还原错误。

**禁止**因此上报差异，包括但不限于：

| 误报类型 | 示例 |
|----------|------|
| 谁被选中 | 设计稿选中第 1 项，页面选中第 2/3 项 → **不算错** |
| 选中带来的边框/底色 | 设计稿某卡有黑边，页面该卡未选中故 `border.color: transparent` → **不算错** |
| 选中带来的展开/折叠 | 设计稿展开「请准备以下材料」，页面因选了别的卡未展开 → **不算错** |
| 自造 prop | 如 `selectedState: 未选中 → 选中` → **禁止写入 diffs** |

**正确做法**：

1. 先识别互斥选项组（开户类型卡、radio、segment、tab 等）。
2. 比对时按**角色**对齐（如「网上转账卡」「CA 卡」「智方便卡」），不要用「当前 DOM 里带黑边的那张」去对设计稿里示意选中的那张。
3. 对每张卡，只比与选中无关的稳定样式（图标尺寸、标题字号、默认间距等）；或明确只比「未选中态」样式。
4. **主按钮禁用态**：先对齐协议勾选等表单完成态再比；不要因「选中了某张卡所以按钮可点」和设计稿灰按钮硬打成选中态误报——若协议未勾完设计稿仍禁用，而页面可点，这是真差异。
5. 用户未要求对齐选中项时，聊天最多一句带过交互态差异，**不要**塞进 `show_design_diffs`。
6. 仅当用户明确说「请点到某某选项再比 / 要比选中态样式」时，才先操作页面切到同一选中项，再比该态下的边框/展开区。

反例（不要这样报）：

> `div.select-item:nth-of-type(3)` 智方便…  
> `selectedState`: 当前 未选中 → 设计稿 选中  
> `border.color`: 当前 transparent → 设计稿 #181818  

（设计稿示意的是另一项选中；页面选了 CA，第 3 项未选中完全正常。）

## 禁止

- 跳过闸门直接截图或臆造差异  
- Target 未设置时用「当前激活 tab」凑合（除非用户明确说用激活 tab）  
- 对非整页小组件链接硬比一整页  
- Figma 与 Target 不是同一屏时仍做细项比对或编造还原度差异  
- 把选项卡/列表「当前选中哪一项」及由此产生的边框、展开、高亮当成还原度错误写入 diffs  
- 比对完成后在聊天里输出差异表格或重复贴图（结果以扩展弹窗为准）  
- 为比对启用 `figma-design-to-code`，或默认下载 Figma 图再回传巨大 base64  
- `show_design_diffs` 返回 `hasFigmaImage: false` 仍声称比对成功  
- 使用 `gapBelow < 0` 或未过容差的微小差异刷 diffs  
