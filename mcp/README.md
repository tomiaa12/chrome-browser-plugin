# Chrome Extension MCP

Cursor 通过 stdio MCP 调用本 Chrome 插件内部方法；Node MCP Server 与插件 background 通过 WebSocket 通信。

## 架构

```text
Cursor  <--stdio-->  MCP/server.js  <--WebSocket ws://127.0.0.1:9527-->  background.js (lib/mcp/bridge.js)
```

消息格式：

请求（MCP → Extension）：

```json
{
  "requestId": "uuid",
  "type": "open_url",
  "payload": { "url": "https://google.com" }
}
```

响应（Extension → MCP）：

```json
{
  "requestId": "uuid",
  "success": true,
  "data": { "tabId": 123, "url": "https://google.com" }
}
```

## 安装依赖

在仓库根目录执行（pnpm workspace monorepo）：

```bash
pnpm install
```

仅 MCP 包：

```bash
pnpm --filter @devtools-net-formatter/mcp install
```

启动 MCP（调试）：

```bash
pnpm mcp
```

## Cursor MCP 配置

```json
{
  "mcpServers": {
    "chrome-extension": {
      "command": "node",
      "args": ["H:/fx/devtools-net-formatter/MCP/server.js"]
    }
  }
}
```

## 运行步骤

1. 在仓库根目录安装依赖：

   ```bash
   cd H:/fx/devtools-net-formatter
   pnpm install
   ```

2. 在 Chrome 加载本仓库根目录为未打包扩展（`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序）。

3. 在 Cursor 中配置 MCP 并重启 Cursor（或刷新 MCP）。

4. Cursor 启动 MCP 后监听 `ws://127.0.0.1:9527`，插件 background 会主动连接。

5. 在 Cursor 对话中调用 MCP 工具（见下表）。

## Figma 比对推荐流程

1. 打开业务页，在插件顶部点 **「设为 MCP 目标页」**。
2. 在 Cursor 聊天中附上 Figma 节点（Figma MCP）+ 本 `chrome-extension` MCP。
3. AI 建议调用顺序：
   - `get_target_tab` — 确认目标页
   - `screenshot_design_width` — 若宽度不是 375，先开设计稿尺寸再整页截图
   - `get_dom_snapshot` — 取几何 / 间距 / 宽高 / padding·margin / 圆角 / 边框 / 颜色 / fontSize·lineHeight·fontWeight / opacity / disabled
   - 与 Figma `get_design_context` / `get_metadata` / 截图比对（**不比文字内容与 font-family**）
   - `show_design_diffs` — 把差异 JSON 推到插件工具箱「Figma 比对」tab
4. 在插件里点差异项，可高亮页面对应节点。

### `show_design_diffs` JSON 示例

```json
{
  "pageUrl": "https://example.com/open-account",
  "figmaNodeId": "4400:11197",
  "figmaFileKey": "5nxoYvWLXhsRDkaWftmytq",
  "diffs": [
    {
      "selector": "p:nth-of-type(1) > span.info",
      "figmaNodeId": "4400:11451",
      "figmaName": "完成进度",
      "issues": [
        {
          "prop": "color",
          "actual": "#333333",
          "expected": "#181818"
        },
        {
          "prop": "gapBelow",
          "actual": 20,
          "expected": 16,
          "unit": "px"
        },
        {
          "prop": "fontWeight",
          "actual": "400",
          "expected": "500"
        },
        {
          "prop": "opacity",
          "actual": 0.8,
          "expected": 1
        },
        {
          "prop": "fontSize",
          "actual": 14,
          "expected": 12,
          "unit": "px"
        },
        {
          "prop": "borderRadius",
          "actual": "8.3px",
          "expected": "8px"
        },
        {
          "prop": "border.width",
          "actual": 1,
          "expected": 0.5,
          "unit": "px"
        }
      ]
    }
  ]
}
```

## 可选环境变量

| 变量                    | 默认值      | 说明                     |
| ----------------------- | ----------- | ------------------------ |
| `CHROME_MCP_WS_HOST`    | `127.0.0.1` | WebSocket 监听地址       |
| `CHROME_MCP_WS_PORT`    | `9527`      | WebSocket 端口           |
| `CHROME_MCP_TIMEOUT_MS` | `30000`     | 等待插件响应超时（毫秒） |

## MCP Tools

| 工具                     | 说明                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `ping`                   | 调用插件 `ping`，返回 `pong`                                         |
| `open_url`               | 在新标签页打开 URL                                                   |
| `get_active_tab`         | 获取当前激活 tab                                                     |
| `get_target_tab`         | 获取 Panel 钉住的 MCP 目标页（比对时优先用这个）                     |
| `set_target_tab`         | 钉住 / 清除 MCP 目标页                                               |
| `run_automation`         | 在目标页执行 Automation 代码（支持 assert*）                         |
| `screenshot_tab`         | 整页截图，返回 PNG base64（可能截断）                                |
| `screenshot_design_width`| 确保 `offsetWidth===375`（否则开设计稿尺寸）后整页截图               |
| `get_dom_snapshot`       | DOM 快照：rect/间距、尺寸、padding·margin、圆角、边框、颜色、字号/行高/字重、opacity、disabled |
| `show_design_diffs`      | 推送差异 JSON 到工具箱「Figma 比对」tab                              |
| `get_network_requests`   | 读取 tab 缓存的 fetch/XHR 抓包                                       |

默认 tab 解析顺序：**显式 tabId → 钉住的 MCP 目标页 → 当前激活 tab**。

## 故障排查

- **Chrome extension is not connected**：先确保 Cursor 已启动 MCP，再在 Chrome 刷新扩展。
- **Request timed out**：检查 `chrome://extensions` 中 background service worker 是否活跃。
- **端口占用**：修改 `CHROME_MCP_WS_PORT`，并同步修改 `lib/mcp/bridge.js` 中的 `WS_URL`。
- **设计稿尺寸 / 截图抢 debugger**：两者已共用 background 单例；若仍失败，关掉页面上的「正受调试」横幅后重试。
