# chrome-browser-plugin · AI Plugin

## 目录

```text
chrome-browser-plugin/             # 仓库根 = 插件根
├── .cursor-plugin/plugin.json   # Cursor
├── .plugin/plugin.json          # OpenPlugin（VS Code Copilot）
├── .claude-plugin/plugin.json   # Claude / Copilot 兼容
├── .github/plugin/plugin.json   # Copilot 插件清单
├── mcp.json                     # Cursor MCP → npx -y chrome-browser-plugin
├── .mcp.json                    # Copilot MCP → npx -y chrome-browser-plugin
├── skills/
│   └── figma-page-compare/
│       └── SKILL.md
├── mcp/                         # npm 包 chrome-browser-plugin 源码
│   ├── package.json
│   ├── server.js
│   ├── build.mjs
│   └── dist/server.cjs
└── README.md
```

## 包含能力

- **MCP**：控制配套 Chrome 扩展（截图、DOM 快照、`show_design_diffs` 等）
- **Skill**：`figma-page-compare`（Figma ↔ 页面还原度比对）

## 使用前

1. Node ≥ 18；MCP 通过 `npx -y chrome-browser-plugin` 从 npm 拉取执行
2. Chrome 加载配套扩展，Panel 点「设为 MCP 目标页」
3. 另配 Figma MCP
