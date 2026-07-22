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
| `get_network_requests` | 读取 fetch/XHR 缓存 | **是** |

页面类工具只操作 Panel「设为 MCP 目标页」钉住的 tab；未设置会报错，不再回退到当前激活页。

`show_design_diffs` 须传 `figmaImageBase64` 和/或 `figmaImageUrl` + `diffs`（**不要**传 `pageImageBase64`，页面图用扩展在 `screenshot_design_width` 时缓存的完整截图）；打开 Panel 内 `sl-dialog`；聊天里只提示去插件查看，勿再贴表格。