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

| 工具 | 说明 | 需 MCP 目标页 |
|------|------|----------------|
| `ping` | 探活 | 否 |
| `open_url` | 打开 URL | 否 |
| `get_active_tab` | 当前激活 tab | 否 |
| `get_target_tab` | 读取 MCP 目标页 | 否 |
| `set_target_tab` | 设置 / 清除目标页 | 否 |
| `show_design_diffs` | 推送截图+差异并打开 Panel 内 sl-dialog | **是** |
| `run_automation` | 在目标页执行 Automation | **是** |
| `screenshot_tab` | 整页截图 | **是** |
| `screenshot_design_width` | 按设计稿宽度（375）截图 | **是** |
| `get_dom_snapshot` | DOM 几何 / 样式快照 | **是** |
| `get_network_requests` | 读取 fetch/XHR + webRequest 缓存 | **是** |
| `snapshot` | 可访问性快照，返回稳定 ref（e1/e2…） | **是**（Chii 需 Panel） |
| `click` / `fill` / `type` / `press_key` / `scroll` | 按 snapshot ref 操作页面 | **是**（Chii 需 Panel） |
| `tabs` | 列出 / 新建 / 关闭 / 切换标签页 | 否 |
| `wait` | 等待选择器、ref、URL 或网络空闲 | **是** |
| `get_console_logs` | 读取页面 console / Chii 控制台缓冲 | **是**（Chii 需 Panel） |
| `get_page_context` | 当前环境、登录用户、语言/端内/黑肤/Mock/设计稿尺寸状态与流程摘要 | **是** |
| `set_page_settings` | 切换语言、模拟端内、黑肤、设计稿尺寸、Mock 总开关 | **是** |
| `quick_sms_login` | 按手机号快捷登录（非生产环境，支持 Chii） | **是** |
| `list_panel_requests` | 查询 Panel 当前接口列表（含 DevTools / Chii，以及 jsBridge / mock 标签） | 否；需 Panel 打开 |
| `get_panel_request` | 查询指定接口请求/响应详情 | 否；需 Panel 打开 |
| `get_api_document` | 查询指定接口的参考文档（`generatedAt` 仅供参考） | 否；需 Panel 打开 |
| `get_flow_nodes` | 查询当前流程节点与激活节点 | 否；需 Panel 打开 |
| `manage_mock_config` | Mock 配置查询、增删改、开关及场景管理 | 否；写操作需文件夹授权 |

页面类工具只操作 Panel「设为 MCP 目标页」钉住的 tab；未设置会报错，不再回退到当前激活页。

页面操作请先 `snapshot` 再按返回的 `ref` 调用 `click` / `fill` / `type`；导航或 DOM 大变后需重新 snapshot。`tabs` 的 `new` / `select` 默认会把该 tab 设为 MCP 目标页。

`list_panel_requests` 每条请求带 `tags`：`jsBridge` / `mock` / `mockName` / `mockScenario` / `chii` / `whistle` / `source`，可用 `jsBridge`、`mock` 布尔参数筛选。`get_network_requests` 同时包含页面 fetch/XHR 与 `chrome.webRequest`（脚本/图片/文档等）。

接口文档及其中的生成时间只代表扩展打包时的参考信息，应以当前接口实际请求和响应为准。Chii 相关能力依赖 Panel 中的 Chii WebSocket 保持连接；设计稿尺寸在 Chii 远程页不可用。Mock 写操作会回写用户已授权的数据文件夹并同步运行时镜像。

`show_design_diffs` 须传 `figmaImageBase64` 和/或 `figmaImageUrl` + `diffs`（**不要**传 `pageImageBase64`，页面图用扩展在 `screenshot_design_width` 时缓存的完整截图）；打开 Panel 内 `sl-dialog`；聊天里只提示去插件查看，勿再贴表格。