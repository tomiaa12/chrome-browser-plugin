# @tomiaa/chrome-mcp-figma-compare

MCP 服务：给 AI 提供 Chrome 页面相关工具（截图、DOM 快照、网络请求、设计差异推送等）。

要求：**Node.js ≥ 18**。

---

## Cursor 安装

```json
{
  "mcpServers": {
    "chrome-extension": {
      "command": "npx",
      "args": ["-y", "@tomiaa/chrome-mcp-figma-compare"],
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
    "chrome-extension": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@tomiaa/chrome-mcp-figma-compare"],
    }
  }
}
```

## 工具一览

| 工具 | 说明 |
|------|------|
| `ping` | 探活 |
| `open_url` | 打开 URL |
| `get_active_tab` | 当前激活 tab |
| `get_target_tab` | 读取 MCP 目标页 |
| `set_target_tab` | 设置 / 清除目标页 |
| `run_automation` | 在目标页执行 Automation |
| `screenshot_tab` | 整页截图 |
| `screenshot_design_width` | 按设计稿宽度（375）截图 |
| `get_dom_snapshot` | DOM 几何 / 样式快照 |
| `show_design_diffs` | 推送设计差异 |
| `get_network_requests` | 读取 fetch/XHR 缓存 |

默认 tab：**显式 `tabId` → 钉住的目标页 → 当前激活 tab**。