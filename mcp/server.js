#!/usr/bin/env node
// Cursor stdio MCP ↔ WebSocket ↔ Chrome 插件
// stdout 留给 MCP 协议，日志走 stderr（Cursor 会显示为 [error]，属正常）

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import * as z from "zod";

/** 将 FILE:/abs/path 展开为 data URL / 纯 base64，供扩展侧展示图片 */
async function resolveLocalFileFields(args, keys) {
  if (!args || typeof args !== "object") return args;
  const out = { ...args };
  for (const key of keys) {
    const value = out[key];
    if (typeof value !== "string") continue;
    const m = value.match(/^FILE:(.+)$/);
    if (!m) continue;
    const filePath = m[1].trim();
    try {
      const buf = await readFile(filePath);
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      const mime = isJpeg ? "image/jpeg" : isPng ? "image/png" : "application/octet-stream";
      // 若原文件内容已是 data URL / 纯文本 base64，直接透传
      const asText = buf.toString("utf8");
      if (asText.startsWith("data:image/") || /^[A-Za-z0-9+/=\s]+$/.test(asText.slice(0, 80))) {
        out[key] = asText.trim();
      } else {
        out[key] = `data:${mime};base64,${buf.toString("base64")}`;
      }
      log(`Expanded ${key} from FILE:${filePath} (${buf.length} bytes)`);
    } catch (e) {
      log(`Failed to expand FILE for ${key}:`, e?.message || e);
    }
  }
  return out;
}

const WS_HOST = process.env.CHROME_MCP_WS_HOST || "127.0.0.1";
const WS_PORT = Number(process.env.CHROME_MCP_WS_PORT || 9527);
const REQUEST_TIMEOUT_MS = Number(process.env.CHROME_MCP_TIMEOUT_MS || 30000);

/** @type {WebSocket | null} */
let extensionSocket = null;

/** @type {WebSocketServer | null} */
let activeWss = null;

/** 待插件回包的 requestId → Promise */
const pendingRequests = new Map();

let shuttingDown = false;

// 必须写 stderr，不能污染 stdout
function log(...args) {
  console.error("[chrome-browser-plugin]", ...args);
}

function closeWebSocketServer() {
  const wss = activeWss;
  activeWss = null;
  if (!wss) return;

  try {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch (_) {
        /* ignore */
      }
    }
    wss.close();
  } catch (_) {
    /* ignore */
  }

  if (extensionSocket) {
    try {
      extensionSocket.terminate();
    } catch (_) {
      /* ignore */
    }
    extensionSocket = null;
  }
}

/** Cursor 重启 MCP 时先关旧进程再起新进程；必须释放 9527，否则新实例 EADDRINUSE */
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Shutting down (${reason})`);
  closeWebSocketServer();
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error(`MCP shutting down: ${reason}`));
  }
  pendingRequests.clear();
  // 给 close 一点时间，再退出
  setTimeout(() => process.exit(0), 50).unref?.();
}

/** 查出占用 TCP 监听端口的 PID（不含自己） */
function listListenPids(port) {
  const myPid = process.pid;
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], {
        encoding: "utf8",
      });
      const pids = new Set();
      const portRe = new RegExp(`:${port}(?:\\s|$)`);
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line) || !portRe.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && pid !== myPid) pids.add(pid);
      }
      return [...pids];
    }

    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    );
    return [
      ...new Set(
        out
          .split(/\n/)
          .map((s) => Number(s.trim()))
          .filter((pid) => pid && pid !== myPid),
      ),
    ];
  } catch {
    return [];
  }
}

function killPid(pid, force) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
}

/** 端口被占时结束占用进程，完成后回调（先 SIGTERM，仍占则 SIGKILL） */
function freeListenPort(port, done) {
  const pids = listListenPids(port);
  if (pids.length === 0) {
    log(`Port ${port} reported in use, but no other LISTEN pid found`);
    done();
    return;
  }

  for (const pid of pids) {
    try {
      killPid(pid, false);
      log(`Sent SIGTERM to pid ${pid} holding port ${port}`);
    } catch (error) {
      log(`Failed to signal pid ${pid}:`, error?.message || String(error));
    }
  }

  setTimeout(() => {
    for (const pid of listListenPids(port)) {
      try {
        killPid(pid, true);
        log(`Force-killed pid ${pid} still holding port ${port}`);
      } catch (error) {
        log(`Failed to kill pid ${pid}:`, error?.message || String(error));
      }
    }
    done();
  }, 250);
}

/** 监听 9527，等待插件 background 连入；端口占用时杀掉旧进程并重试 */
function startWebSocketServer(retryLeft = 10) {
  if (shuttingDown) return null;

  const wss = new WebSocketServer({
    host: WS_HOST,
    port: WS_PORT,
  });
  activeWss = wss;

  wss.on("listening", () => {
    log(`WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
  });

  wss.on("connection", (ws) => {
    if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
      log("Replacing previous Chrome extension connection");
      extensionSocket.close();
    }

    extensionSocket = ws;
    log("Chrome extension connected");

    const heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "_heartbeat" }));
      }
    }, 20000);

    ws.on("message", (raw) => {
      // 插件 → MCP：{ requestId, success, data }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        log("Invalid JSON from extension:", error?.message || String(error));
        return;
      }

      if (message.type === "_heartbeat") {
        return;
      }

      const { requestId, success, data } = message;
      if (!requestId || !pendingRequests.has(requestId)) {
        return;
      }

      const pending = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      clearTimeout(pending.timer);

      if (success) {
        pending.resolve(data);
      } else {
        const errorMessage =
          data && typeof data.error === "string"
            ? data.error
            : "Chrome extension returned an error";
        pending.reject(new Error(errorMessage));
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeatTimer);
      if (extensionSocket === ws) {
        extensionSocket = null;
        log("Chrome extension disconnected");
      }
    });

    ws.on("error", (error) => {
      log("WebSocket client error:", error?.message || String(error));
    });
  });

  wss.on("error", (error) => {
    const msg = error?.message || String(error);
    const code = error?.code;
    log("WebSocket server error:", msg);
    if (activeWss === wss) {
      activeWss = null;
    }
    try {
      wss.close();
    } catch (_) {
      /* ignore */
    }

    // Cursor 热重启时旧进程可能尚未释放端口：杀掉占用者再抢
    if ((code === "EADDRINUSE" || /EADDRINUSE/i.test(msg)) && retryLeft > 0) {
      log(
        `Port ${WS_PORT} in use; killing holders then retrying (${retryLeft} left).`,
      );
      freeListenPort(WS_PORT, () => {
        setTimeout(() => startWebSocketServer(retryLeft - 1), 100);
      });
      return;
    }

    if (code === "EADDRINUSE" || /EADDRINUSE/i.test(msg)) {
      log(
        `Fatal: ws://${WS_HOST}:${WS_PORT} still in use after kill attempts. Set CHROME_MCP_WS_PORT or free the port manually.`,
      );
    }
    process.exit(1);
  });

  return wss;
}

/** 转发到插件并等待异步响应 */
export function sendToExtension(type, payload = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || REQUEST_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      reject(
        new Error(
          "Chrome extension is not connected. Load the extension in Chrome and ensure it can reach ws://127.0.0.1:9527",
        ),
      );
      return;
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${type}`));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });

    extensionSocket.send(
      JSON.stringify({
        requestId,
        type,
        payload,
      }),
    );
  });
}

function toolText(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** 注册 ping / open_url / get_active_tab，均经 sendToExtension 下发 */
function createMcpServer() {  const mcpServer = new McpServer({
    name: "chrome-browser-plugin",
    version: "1.0.0",
  });

  mcpServer.registerTool(
    "ping",
    {
      description: "Ping the Chrome extension. Returns pong when connected.",
      inputSchema: {},
    },
    async () => {
      const data = await sendToExtension("ping", {});
      return toolText(data ?? "pong");
    },
  );

  mcpServer.registerTool(
    "open_url",
    {
      description: "Open a URL in a new browser tab via the Chrome extension.",
      inputSchema: {
        url: z.string().url().describe("URL to open, e.g. https://google.com"),
      },
    },
    async ({ url }) => {
      const data = await sendToExtension("open_url", { url });
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "get_active_tab",
    {
      description: "Get information about the currently active browser tab.",
      inputSchema: {},
    },
    async () => {
      const data = await sendToExtension("get_active_tab", {});
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "get_target_tab",
    {
      description:
        "Get the pinned MCP target tab (set via extension panel 「设为 MCP 目标页」). Page tools require this to be set.",
      inputSchema: {},
    },
    async () => {
      const data = await sendToExtension("get_target_tab", {});
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "set_target_tab",
    {
      description:
        "Pin or clear the MCP target tab. Usually set from the extension panel「设为 MCP 目标页」; optional for AI. Page tools fail until pinned.",
      inputSchema: {
        tabId: z.number().int().optional().describe("Tab id to pin; omit to pin current active tab"),
        clear: z.boolean().optional().describe("If true, clear pinned target"),
      },
    },
    async ({ tabId, clear }) => {
      const data = await sendToExtension("set_target_tab", { tabId, clear });
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "run_automation",
    {
      description:
        "Run Automation code in the pinned MCP target tab MAIN world. Requires「设为 MCP 目标页」first. Supports assertVisible/assertText (throws on failure).",
      inputSchema: {
        code: z.string().describe("Automation JS, e.g. await Automation.click('.btn')"),
        timeoutMs: z.number().int().optional().describe("MCP wait timeout, default 120000"),
      },
    },
    async ({ code, timeoutMs }) => {
      const data = await sendToExtension(
        "run_automation",
        { code },
        { timeoutMs: timeoutMs || 120000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "screenshot_tab",
    {
      description:
        "Capture full-page PNG of the pinned MCP target tab (returns base64, may truncate). Requires「设为 MCP 目标页」first.",
      inputSchema: {
        maxBase64Length: z.number().int().optional().describe("Default 120000"),
        timeoutMs: z.number().int().optional().describe("Default 60000"),
      },
    },
    async ({ maxBase64Length, timeoutMs }) => {
      const data = await sendToExtension(
        "screenshot_tab",
        { maxBase64Length },
        { timeoutMs: timeoutMs || 60000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "set_design_width",
    {
      description:
        "Enable design-size viewport (default 375×812) on the pinned MCP target tab without screenshot. Requires「设为 MCP 目标页」first.",
      inputSchema: {
        width: z.number().int().optional().describe("Design width, default 375"),
        height: z.number().int().optional().describe("Design height, default 812"),
        timeoutMs: z.number().int().optional().describe("Default 30000"),
      },
    },
    async ({ width, height, timeoutMs }) => {
      const data = await sendToExtension(
        "set_design_width",
        { width, height },
        { timeoutMs: timeoutMs || 30000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "screenshot_design_width",
    {
      description:
        "Capture full-page PNG of the pinned MCP target tab at design width (default 375). Requires「设为 MCP 目标页」first. If documentElement.offsetWidth !== 375, enables mobile design-size emulation first. Use for Figma vs page visual compare.",
      inputSchema: {
        width: z.number().int().optional().describe("Design width, default 375"),
        height: z.number().int().optional().describe("Design height, default 812"),
        maxBase64Length: z.number().int().optional().describe("Default 120000"),
        timeoutMs: z.number().int().optional().describe("Default 90000"),
      },
    },
    async ({ width, height, maxBase64Length, timeoutMs }) => {
      const data = await sendToExtension(
        "screenshot_design_width",
        { width, height, maxBase64Length },
        { timeoutMs: timeoutMs || 90000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "get_dom_snapshot",
    {
      description:
        "DOM snapshot of the pinned MCP target tab for Figma compare: rect/spacing (gapBelow/gapRight), size, padding/margin, borderRadius, border, color/backgroundColor, fontSize/lineHeight/fontWeight, opacity, disabled. Requires「设为 MCP 目标页」first. Prefer after screenshot_design_width.",
      inputSchema: {
        maxNodes: z.number().int().optional().describe("Default 120"),
        timeoutMs: z.number().int().optional().describe("Default 60000"),
      },
    },
    async ({ maxNodes, timeoutMs }) => {
      const data = await sendToExtension(
        "get_dom_snapshot",
        { maxNodes },
        { timeoutMs: timeoutMs || 60000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "show_design_diffs",
    {
      description:
        "Push Figma-vs-page compare result to the Chrome extension Panel sl-dialog. Page shot is cached by screenshot_design_width — do NOT pass pageImageBase64. Prefer putting the Figma get_screenshot https URL into figmaImageBase64 (URL accepted). Optional figmaImageUrl can mirror the same URL. After call, verify hasFigmaImage===true or retry. Requires「设为 MCP 目标页」. Tell user to view Panel dialog — do NOT dump markdown tables in chat.",
      inputSchema: {
        pageUrl: z.string().optional(),
        figmaNodeId: z.string().optional(),
        figmaFileKey: z.string().optional(),
        figmaImageBase64: z
          .string()
          .optional()
          .describe(
            "PREFERRED: Figma get_screenshot https URL (extension accepts URL here). Also accepts raw base64 / data URL. Avoid huge base64 when URL works.",
          ),
        figmaImageUrl: z
          .string()
          .optional()
          .describe("Optional mirror of the same Figma image URL; prefer also setting figmaImageBase64 to the URL"),
        pageImageBase64: z
          .string()
          .optional()
          .describe("DEPRECATED — ignored; extension uses cached page shot from screenshot_design_width"),
        diffs: z
          .array(z.record(z.any()))
          .describe(
            "Mismatched nodes: [{ selector, figmaNodeId?, figmaName?, note?, issues: [{ prop, actual, expected, unit? }] }]. Dedupe same-pattern issues; ignore gapBelow<0 and ≤1px noise.",
          ),
      },
    },
    async (args) => {
      const resolved = await resolveLocalFileFields(args, ["figmaImageBase64"]);
      // 页面图由扩展缓存，去掉 AI 回传避免截断图覆盖缓存
      delete resolved.pageImageBase64;
      delete resolved.pageImage;
      const data = await sendToExtension("show_design_diffs", resolved, {
        timeoutMs: 60000,
      });
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "get_network_requests",
    {
      description:
        "Get cached network captures for the pinned MCP target tab: page fetch/XHR plus chrome.webRequest (document/script/image/etc). Requires「设为 MCP 目标页」first.",
      inputSchema: {
        urlPattern: z.string().optional().describe("Filter by URL substring"),
        method: z.string().optional().describe("HTTP method, e.g. GET"),
        kind: z
          .string()
          .optional()
          .describe("fetch, xhr, or webRequest type such as script/image/document"),
        sinceMs: z.number().int().optional().describe("Only entries captured at/after this epoch ms"),
        includeBody: z.boolean().optional().describe("Include request/response body; default true"),
        limit: z.number().int().optional().describe("Default 50"),
      },
    },
    async (args) => toolText(await sendToExtension("get_network_requests", args)),
  );

  mcpServer.registerTool(
    "get_page_context",
    {
      description:
        "Get the pinned page environment (normal/DevTools/Chii), current logged-in user, language, JSBridge/dark/mock/design-size state, and current flow summary. Requires the extension Panel for Chii/flow data.",
      inputSchema: {},
    },
    async () => toolText(await sendToExtension("get_page_context", {})),
  );

  mcpServer.registerTool(
    "set_page_settings",
    {
      description:
        "Set pinned page controls exposed by the extension Panel: language, simulated in-app JSBridge, dark skin, design-size viewport, and Mock master switch. Chii is supported except design-size.",
      inputSchema: {
        language: z.enum(["zhCn", "zhTc", "en"]).optional(),
        jsBridge: z.boolean().optional(),
        darkSkin: z.boolean().optional(),
        designSize: z.boolean().optional(),
        mockEnabled: z.boolean().optional(),
        width: z.number().int().optional().describe("Design viewport width, default 375"),
        height: z.number().int().optional().describe("Design viewport height, default 812"),
        reload: z.boolean().optional().describe("Reload after storage-backed changes; default true"),
      },
    },
    async (args) =>
      toolText(
        await sendToExtension("set_page_settings", args, { timeoutMs: 60000 }),
      ),
  );

  mcpServer.registerTool(
    "quick_sms_login",
    {
      description:
        "Log the pinned page in by phone using the Panel's quick SMS login capability, then apply the returned session storage plan. Non-production environments only; supports Chii when its Panel connection is active.",
      inputSchema: {
        phone: z.string().min(1),
        areaCode: z.string().optional().describe('Default "+86"'),
        env: z.enum(["sit", "uat", "dev", "gray"]).optional().describe("Default sit"),
        code: z.string().optional().describe("Test SMS code, default 123456"),
      },
    },
    async (args) =>
      toolText(
        await sendToExtension("quick_sms_login", args, { timeoutMs: 120000 }),
      ),
  );

  mcpServer.registerTool(
    "list_panel_requests",
    {
      description:
        "List the requests currently shown/captured by the extension Panel, including DevTools and Chii data. Each item includes tags for jsBridge / mock / chii / whistle. Returns stable rowId values for detail/document lookup.",
      inputSchema: {
        urlPattern: z.string().optional(),
        type: z
          .string()
          .optional()
          .describe("Panel resource type, e.g. xhr, document, script, image, websocket"),
        jsBridge: z
          .boolean()
          .optional()
          .describe("If true, only JSBridge calls; if false, exclude them"),
        mock: z
          .boolean()
          .optional()
          .describe("If true, only Mock-hit requests; if false, exclude them"),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
      },
    },
    async (args) =>
      toolText(await sendToExtension("list_panel_requests", args)),
  );

  const requestSelectorSchema = {
    rowId: z.union([z.string(), z.number()]).optional(),
    url: z.string().optional().describe("Substring match; newest match wins"),
    index: z.number().int().min(0).optional(),
  };

  mcpServer.registerTool(
    "get_panel_request",
    {
      description:
        "Get one Panel request's headers, request/response data and optionally decrypted response body. Select by rowId (preferred), URL substring, or zero-based index.",
      inputSchema: {
        ...requestSelectorSchema,
        includeResponseBody: z.boolean().optional().describe("Default true"),
        decrypt: z.boolean().optional().describe("Default true"),
      },
    },
    async (args) =>
      toolText(
        await sendToExtension("get_panel_request", args, { timeoutMs: 60000 }),
      ),
  );

  mcpServer.registerTool(
    "get_api_document",
    {
      description:
        "Get the bundled API document matched to a captured Panel request. generatedAt and documentation timestamps are reference-only — trust the live response, not the doc time.",
      inputSchema: requestSelectorSchema,
    },
    async (args) => toolText(await sendToExtension("get_api_document", args)),
  );

  mcpServer.registerTool(
    "get_flow_nodes",
    {
      description:
        "Get the current Panel flow-chart route, active node, and all flow nodes. Works with the Panel's normal, DevTools, and Chii route context.",
      inputSchema: {},
    },
    async () => toolText(await sendToExtension("get_flow_nodes", {})),
  );

  mcpServer.registerTool(
    "manage_mock_config",
    {
      description:
        "List/get/create/update/delete Mock interfaces, enable/disable an interface, or upsert/delete a scenario. Mutations require a write-authorized Mock data folder in the extension; changes are written to disk and synced to the runtime mirror.",
      inputSchema: {
        action: z
          .enum([
            "list",
            "get",
            "create",
            "update",
            "delete",
            "set_enabled",
            "upsert_scenario",
            "delete_scenario",
          ])
          .describe("Mock operation"),
        name: z.string().optional().describe("Interface name"),
        newName: z.string().optional().describe("Rename target for update"),
        groupId: z.string().optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.any()).optional(),
        fileName: z.string().optional(),
        content: z.string().optional(),
        activate: z.boolean().optional().describe("Apply upserted scenario; default true"),
      },
    },
    async (args) =>
      toolText(
        await sendToExtension("manage_mock_config", args, {
          timeoutMs: 120000,
        }),
      ),
  );

  mcpServer.registerTool(
    "snapshot",
    {
      description:
        "Accessibility snapshot of the pinned page with stable refs (e1, e2…). Use refs with click/fill/type/scroll. Requires「设为 MCP 目标页」or an active Chii Panel.",
      inputSchema: {
        maxNodes: z.number().int().optional().describe("Default 120, max 400"),
      },
    },
    async (args) =>
      toolText(await sendToExtension("snapshot", args, { timeoutMs: 30000 })),
  );

  mcpServer.registerTool(
    "click",
    {
      description: "Click a snapshot ref on the pinned page. Call snapshot first.",
      inputSchema: {
        ref: z.string().describe("Ref from snapshot, e.g. e3"),
      },
    },
    async (args) =>
      toolText(await sendToExtension("click", args, { timeoutMs: 30000 })),
  );

  mcpServer.registerTool(
    "fill",
    {
      description: "Set an input/textarea value by snapshot ref in one shot.",
      inputSchema: {
        ref: z.string(),
        value: z.string(),
      },
    },
    async (args) =>
      toolText(await sendToExtension("fill", args, { timeoutMs: 30000 })),
  );

  mcpServer.registerTool(
    "type",
    {
      description: "Type into a snapshot ref character by character. clear defaults to true.",
      inputSchema: {
        ref: z.string(),
        text: z.string(),
        delay: z.number().int().optional().describe("Per-key delay ms, default 20"),
        clear: z.boolean().optional().describe("Clear existing value first; default true"),
      },
    },
    async (args) =>
      toolText(await sendToExtension("type", args, { timeoutMs: 60000 })),
  );

  mcpServer.registerTool(
    "press_key",
    {
      description: "Dispatch a key (Enter, Tab, Escape, Backspace, ArrowDown…) on a ref or the focused element.",
      inputSchema: {
        key: z.string(),
        ref: z.string().optional(),
        ctrlKey: z.boolean().optional(),
        metaKey: z.boolean().optional(),
        altKey: z.boolean().optional(),
        shiftKey: z.boolean().optional(),
      },
    },
    async (args) =>
      toolText(await sendToExtension("press_key", args, { timeoutMs: 15000 })),
  );

  mcpServer.registerTool(
    "scroll",
    {
      description:
        "Scroll the page or a snapshot ref. With ref and no x/y, scrolls the element into view. Without ref, scrolls the window (default y=400).",
      inputSchema: {
        ref: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        block: z.enum(["start", "center", "end", "nearest"]).optional(),
      },
    },
    async (args) =>
      toolText(await sendToExtension("scroll", args, { timeoutMs: 15000 })),
  );

  mcpServer.registerTool(
    "tabs",
    {
      description:
        "List/create/close/select Chrome tabs. new/select pin the tab as MCP target by default.",
      inputSchema: {
        action: z.enum(["list", "new", "close", "select"]).describe("Tab operation"),
        url: z.string().optional().describe("For new"),
        tabId: z.number().int().optional().describe("For close/select"),
        active: z.boolean().optional().describe("Whether new tab is focused; default true"),
        pin: z.boolean().optional().describe("Pin as MCP target; default true for new/select"),
        currentWindow: z.boolean().optional().describe("list current window only; default true"),
      },
    },
    async (args) => toolText(await sendToExtension("tabs", args)),
  );

  mcpServer.registerTool(
    "wait",
    {
      description:
        "Wait for a selector, snapshot ref, URL substring, or network idle on the pinned page.",
      inputSchema: {
        kind: z
          .enum(["selector", "ref", "url", "network_idle"])
          .optional()
          .describe("Inferred from selector/url when omitted; otherwise network_idle"),
        selector: z.string().optional(),
        ref: z.string().optional(),
        url: z.string().optional().describe("URL substring"),
        quietMs: z.number().int().optional().describe("network_idle quiet window, default 500"),
        timeoutMs: z.number().int().optional().describe("Default 15000"),
      },
    },
    async (args) =>
      toolText(
        await sendToExtension("wait", args, {
          timeoutMs: (args.timeoutMs || 15000) + 5000,
        }),
      ),
  );

  mcpServer.registerTool(
    "get_console_logs",
    {
      description:
        "Read recent console logs from the pinned page (injected hook) or Chii Runtime.consoleAPICalled buffer.",
      inputSchema: {
        level: z.enum(["log", "info", "warn", "error", "debug"]).optional(),
        limit: z.number().int().optional().describe("Default 80"),
        clear: z.boolean().optional().describe("Clear buffer after read"),
      },
    },
    async (args) => toolText(await sendToExtension("get_console_logs", args)),
  );

  return mcpServer;
}

async function main() {
  startWebSocketServer();

  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  log("MCP stdio server started");

  // Cursor 关/重启 MCP：stdio 断开或发信号时立刻释放 9527
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.stdin.on("end", () => shutdown("stdin end"));
  process.stdin.on("close", () => shutdown("stdin close"));
}

main().catch((error) => {
  log("Fatal error:", error?.message || String(error));
  process.exit(1);
});
