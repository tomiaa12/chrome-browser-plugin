---
name: chrome-plugin-skills
description: >-
  Fetches the latest agent skills from the connected Chrome extension before
  using chrome-browser-plugin. MUST call list_skills / get_skill first; do not
  follow cached or local copies. Use when the user asks for Figma vs page
  还原度比对、设计走查、设计差异、show_design_diffs, or any specialized
  chrome-browser-plugin / Chrome 扩展 MCP workflow. Do not use for Figma
  设计稿落地/转代码.
---

# 从 Chrome 扩展拉取最新 Skill

chrome-browser-plugin **只保留本引导**。业务 Skill 正文全部在配套 Chrome 扩展里维护。

**禁止**凭记忆、缓存、旧版 `figma-page-compare` 或本仓库里的流程直接开干。

## 强制步骤（每次相关任务都要做）

1. 用 `chrome-browser-plugin` 的 `list_skills` 拉目录（`id` / `name` / `description`）。
2. 对照用户意图选匹配项（例如还原度比对 → `figma-page-compare`）。
3. 用 `get_skill` 传入该 `id` 或 `name`，拿到完整 markdown。
4. **只按这次返回的正文执行**；工具 schema 以当次 MCP 为准。

扩展未连接 / `Chrome extension is not connected`：停止，提示先加载配套扩展并连上 `ws://127.0.0.1:9527`。不要臆造流程。

目录里没有匹配项：用通用 MCP 工具即可，不要发明一套专用流程。

## 不要

- 跳过 `list_skills` / `get_skill` 直接截图、比对或推 `show_design_diffs`
- 把本文件当成业务 Skill（这里没有闸门、容差、diffs 格式）
- 为比对去读 `figma-design-to-code`
