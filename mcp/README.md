# chrome-browser-plugin

MCP 服务：给 AI 提供 Chrome 页面相关工具（截图、DOM 快照、网络请求、设计差异推送等）。

要求：**Node.js ≥ 18**。

---

## Cursor 安装

```json
{
  "mcpServers": {
    "chrome-browser-plugin": {
      "command": "npx",
      "args": ["-y", "chrome-browser-plugin"]
    }
  }
}
```

## VS Code 安装

VS Code 使用 `.vscode/mcp.json`（或用户级 MCP 配置），根键是 **`servers`**（不是 Cursor 的 `mcpServers`）。

### 1. 打开配置

任选其一：

- 命令面板：`MCP: Open User Configuration`（全局）
- 命令面板：`MCP: Open Workspace Folder MCP Configuration`（工作区 `.vscode/mcp.json`）
- 手动创建项目下的 `.vscode/mcp.json`

### 2. 写入配置

```json
{
  "servers": {
    "chrome-browser-plugin": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrome-browser-plugin"]
    }
  }
}
```

## 工具一览

| 工具 | 说明 | 需指定 tab |
|------|------|----------------|
| `ping` | 探活 | 否 |
| `open_url` | 打开 URL | 否 |
| `get_active_tab` | 当前激活 tab | 否 |
| `get_target_tab` | 兼容旧钉住接口（可选） | 否 |
| `set_target_tab` | 兼容旧钉住接口（可选） | 否 |
| `show_design_diffs` | 推送截图+差异并打开 Panel 内 sl-dialog | 可选 `tabId` |
| `run_automation` | 在目标页执行 Automation | 可选 `tabId` |
| `screenshot_tab` | 整页截图 | 可选 `tabId` |
| `screenshot_design_width` | 按设计稿宽度（375）截图 | 可选 `tabId` |
| `get_dom_snapshot` | DOM 几何 / 样式快照 | 可选 `tabId` |
| `get_network_requests` | 读取 fetch/XHR + webRequest 缓存 | 可选 `tabId` |
| `snapshot` | 可访问性快照，返回稳定 ref（e1/e2…） | 可选 `tabId`（Chii 需 Panel） |
| `click` / `fill` / `type` / `press_key` / `scroll` | 按 snapshot ref / selector / 文案 / 坐标操作页面 | 可选 `tabId`（Chii 需 Panel） |
| `goto` | 当前 tab 跳转（不新开） | 可选 `tabId` |
| `go_back` / `go_forward` | 历史前进后退 | 可选 `tabId` |
| `eval_js` | 在页面 MAIN world 执行 JS 并返回值 | 可选 `tabId` |
| `hover` | CDP 悬停（ref / selector / 文案 / 坐标） | 可选 `tabId` |
| `fill_form` | 一次填多个字段 | 可选 `tabId` |
| `drag` | CDP 拖拽 | 可选 `tabId` |
| `upload_file` | 给 file input 设置本机绝对路径文件 | 可选 `tabId` |
| `debugger_attach` / `debugger_detach` | 显式挂/卸 chrome.debugger | 可选 `tabId` |
| `cdp_send` | 发送原始 CDP 命令（首次自动 attach） | 可选 `tabId` |
| `cdp_events` | 读取该 tab 的 CDP 事件缓冲 | 可选 `tabId` |
| `handle_dialog` | 处理 alert/confirm/prompt | 可选 `tabId` |
| `tabs` | 列出 / 新建 / 关闭 / 切换标签页 | 否 |
| `wait` | 等待选择器、ref、URL 或网络空闲 | 可选 `tabId` |
| `get_console_logs` | 读取页面 console / Chii 控制台缓冲 | 可选 `tabId`（Chii 需 Panel） |
| `get_page_context` | 当前环境、登录用户、语言/端内/黑肤/Mock/设计稿尺寸状态与流程摘要 | 可选 `tabId` |
| `set_page_settings` | 切换语言、模拟端内、黑肤、设计稿尺寸、Mock 总开关 | 可选 `tabId` |
| `quick_sms_login` | 按手机号快捷登录（非生产环境，支持 Chii） | 可选 `tabId` |
| `list_panel_requests` | 查询 Panel 当前接口列表（含 DevTools / Chii，以及 jsBridge / mock 标签） | 否；需 Panel 打开 |
| `get_panel_request` | 查询指定接口请求/响应详情 | 否；需 Panel 打开 |
| `get_api_document` | 查询指定接口的参考文档（`generatedAt` 仅供参考） | 否；需 Panel 打开 |
| `get_flow_nodes` | 查询当前流程节点与激活节点 | 否；需 Panel 打开 |
| `manage_mock_config` | Mock 配置查询、增删改、开关及场景管理 | 否；写操作需文件夹授权 |

页面类工具默认操作当前激活 tab；传入 `tabId` 则操作指定页。可在扩展 Panel 点「复制 tabId」。

页面操作可用 `snapshot` 的 `ref`，也可用 `selector` / 可见文案 / `x`+`y`。`goto` 改当前 tab 地址；`open_url` 仍是新开页。`cdp_send` 会自动 attach debugger；`debugger_detach` 可能同时结束该 tab 的设计稿尺寸模拟。`upload_file` 需要 Chrome 能读到的本机绝对路径。

`list_panel_requests` 每条请求带 `tags`：`jsBridge` / `mock` / `mockName` / `mockScenario` / `chii` / `whistle` / `source`，可用 `jsBridge`、`mock` 布尔参数筛选。`get_network_requests` 同时包含页面 fetch/XHR 与 `chrome.webRequest`（脚本/图片/文档等）。

接口文档及其中的生成时间只代表扩展打包时的参考信息，应以当前接口实际请求和响应为准。Chii 相关能力依赖 Panel 中的 Chii WebSocket 保持连接；设计稿尺寸在 Chii 远程页不可用。Mock 写操作会回写用户已授权的数据文件夹并同步运行时镜像。

`show_design_diffs` 须传 `figmaImageBase64` 和/或 `figmaImageUrl` + `diffs`（**不要**传 `pageImageBase64`，页面图用扩展在 `screenshot_design_width` 时缓存的完整截图）；打开 Panel 内 `sl-dialog`；聊天里只提示去插件查看，勿再贴表格。