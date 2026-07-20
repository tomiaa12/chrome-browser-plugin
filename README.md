# chrome-browser-plugin · AI Plugin

## 目录

```text
chrome-browser-plugin/             # 仓库根 = 插件根
├── .cursor-plugin/plugin.json   # Cursor
├── .plugin/plugin.json          # OpenPlugin（VS Code Copilot）
├── .claude-plugin/plugin.json   # Claude / Copilot 兼容
├── .github/plugin/plugin.json   # Copilot 插件清单
├── mcp.json                     # Cursor MCP → ./mcp/dist/server.cjs
├── .mcp.json                    # Copilot MCP → ${PLUGIN_ROOT}/mcp/dist/server.cjs
├── skills/
│   └── figma-page-compare/
│       └── SKILL.md
├── mcp/
│   ├── package.json
│   ├── server.js                # 源码
│   ├── build.mjs
│   └── dist/server.cjs          # 打包产物（bin / MCP 入口，含依赖）
└── README.md
```

## 包含能力

- **MCP**：控制配套 Chrome 扩展（截图、DOM 快照、`show_design_diffs` 等）
- **Skill**：`figma-page-compare`（Figma ↔ 页面还原度比对）

## 使用前

1. Node ≥ 18；首次改 MCP 源码后：`cd mcp && pnpm install && pnpm build`（生成 `dist/server.cjs`）
2. Chrome 加载配套扩展，Panel 点「设为 MCP 目标页」
3. 另配 Figma MCP
