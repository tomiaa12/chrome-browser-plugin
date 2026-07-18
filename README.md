# chrome-mcp-figma-compare · AI Plugin

这是 **AI Agent 插件**（不是 VS Code 传统扩展 / VSIX）。

同时兼容：

| 宿主 | 清单 | 参考 |
|------|------|------|
| **Cursor Marketplace** | `.cursor-plugin/plugin.json` + `mcp.json` + `skills/` | [Cursor Plugins](https://cursor.com/docs/plugins) |
| **VS Code Copilot Agent Plugin** | `.plugin/` / `.claude-plugin/` / `.github/plugin/` + `.mcp.json` + `skills/` | [github/copilot-plugins](https://github.com/github/copilot-plugins)、[Agent plugins](https://code.visualstudio.com/docs/copilot/customization/agent-plugins) |

## 目录

```text
chrome-mcp-figma-compare/          # 仓库根 = 插件根
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

> Chrome 扩展本体在独立仓库 [devtools-net-formatter](https://github.com/tomiaa12/dev-tools-network)（`network-decrypt/`），**不会**随本 AI 插件安装。

## 使用前

1. Node ≥ 18；首次改 MCP 源码后：`cd mcp && pnpm install && pnpm build`（生成 `dist/server.cjs`）
2. Chrome 加载配套扩展，Panel 点「设为 MCP 目标页」
3. 另配 Figma MCP

## 本地调试

### Cursor

把本仓库根目录拷到：

```text
%USERPROFILE%\.cursor\plugins\local\chrome-mcp-figma-compare\
```

Reload Window。确认 MCP / Skill 出现。

### VS Code Copilot

1. 开启 `chat.plugins.enabled`
2. 用 Agent Plugin / marketplace 加载本仓库根目录
3. Skill 出现在 Configure Skills；MCP 出现在 MCP 列表

## 发布

| 渠道 | 做法 |
|------|------|
| Cursor Marketplace | 以本仓库根为插件根 → [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) |
| VS Code Copilot | 推公开 Git；marketplace.json 的 `source` 指向本仓库根 |

**不要**对本目录跑 `vsce package`——那是传统扩展，不是 AI 插件。
