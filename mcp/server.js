#!/usr/bin/env node
// Cursor stdio MCP ↔ WebSocket ↔ Chrome 插件
// stdout 留给 MCP 协议，日志走 stderr（Cursor 会显示为 [error]，属正常）

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import * as z from "zod";

const WS_HOST = process.env.CHROME_MCP_WS_HOST || "127.0.0.1";
const WS_PORT = Number(process.env.CHROME_MCP_WS_PORT || 9527);
const REQUEST_TIMEOUT_MS = Number(process.env.CHROME_MCP_TIMEOUT_MS || 30000);

/** @type {WebSocket | null} */
let extensionSocket = null;

/** 待插件回包的 requestId → Promise */
const pendingRequests = new Map();

// 必须写 stderr，不能污染 stdout
function log(...args) {  console.error("[devtools-net-formatter-mcp]", ...args);
}

/** 监听 9527，等待插件 background 连入；端口占用时重试，避免 Cursor 卡在旧 tool 列表 */
function startWebSocketServer(retryLeft = 8) {
  const wss = new WebSocketServer({
    host: WS_HOST,
    port: WS_PORT,
  });

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
    try {
      wss.close();
    } catch (_) {
      /* ignore */
    }

    if ((code === "EADDRINUSE" || /EADDRINUSE/i.test(msg)) && retryLeft > 0) {
      log(
        `Port ${WS_PORT} in use; retrying in 500ms (${retryLeft} left). ` +
          `If this persists, Restart MCP after the previous instance exits.`,
      );
      setTimeout(() => startWebSocketServer(retryLeft - 1), 500);
      return;
    }

    if (code === "EADDRINUSE" || /EADDRINUSE/i.test(msg)) {
      log(
        `Fatal: ws://${WS_HOST}:${WS_PORT} still in use. Free the port or set CHROME_MCP_WS_PORT.`,
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
    name: "devtools-net-formatter",
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
        "Get the pinned MCP target tab (set via extension panel 「设为 MCP 目标页」). Prefer this over get_active_tab for design comparison.",
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
        "Pin or clear the MCP target tab. Usually set from the extension panel; optional for AI.",
      inputSchema: {
        tabId: z.number().int().optional().describe("Tab id to pin"),
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
        "Run Automation code in the MCP target tab (or active tab) MAIN world. Supports assertVisible/assertText (throws on failure).",
      inputSchema: {
        code: z.string().describe("Automation JS, e.g. await Automation.click('.btn')"),
        tabId: z.number().int().optional().describe("Target tab id; default pinned MCP target, else active tab"),
        timeoutMs: z.number().int().optional().describe("MCP wait timeout, default 120000"),
      },
    },
    async ({ code, tabId, timeoutMs }) => {
      const data = await sendToExtension(
        "run_automation",
        { code, tabId },
        { timeoutMs: timeoutMs || 120000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "screenshot_tab",
    {
      description: "Capture full-page PNG screenshot of a tab (returns base64, may truncate).",
      inputSchema: {
        tabId: z.number().int().optional(),
        maxBase64Length: z.number().int().optional().describe("Default 120000"),
        timeoutMs: z.number().int().optional().describe("Default 60000"),
      },
    },
    async ({ tabId, maxBase64Length, timeoutMs }) => {
      const data = await sendToExtension(
        "screenshot_tab",
        { tabId, maxBase64Length },
        { timeoutMs: timeoutMs || 60000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "screenshot_design_width",
    {
      description:
        "Capture full-page PNG at design width (default 375). If documentElement.offsetWidth !== 375, enables mobile design-size emulation first, then screenshots. Use for Figma vs page visual compare.",
      inputSchema: {
        tabId: z.number().int().optional(),
        width: z.number().int().optional().describe("Design width, default 375"),
        height: z.number().int().optional().describe("Design height, default 812"),
        maxBase64Length: z.number().int().optional().describe("Default 120000"),
        timeoutMs: z.number().int().optional().describe("Default 90000"),
      },
    },
    async ({ tabId, width, height, maxBase64Length, timeoutMs }) => {
      const data = await sendToExtension(
        "screenshot_design_width",
        { tabId, width, height, maxBase64Length },
        { timeoutMs: timeoutMs || 90000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "get_dom_snapshot",
    {
      description:
        "DOM snapshot of MCP target tab for Figma compare: rect/spacing (gapBelow/gapRight), size, padding/margin, borderRadius, border, color/backgroundColor, fontSize/lineHeight/fontWeight, opacity, disabled. Ignores text content and font-family for diffs. Prefer after screenshot_design_width.",
      inputSchema: {
        tabId: z.number().int().optional(),
        maxNodes: z.number().int().optional().describe("Default 120"),
        timeoutMs: z.number().int().optional().describe("Default 60000"),
      },
    },
    async ({ tabId, maxNodes, timeoutMs }) => {
      const data = await sendToExtension(
        "get_dom_snapshot",
        { tabId, maxNodes },
        { timeoutMs: timeoutMs || 60000 },
      );
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "show_design_diffs",
    {
      description:
        "Push Figma-vs-page diff JSON to the extension toolbox tab「Figma 比对」. Call after comparing Figma MCP + get_dom_snapshot. Pass diffs as an array of { selector, figmaNodeId?, figmaName?, issues: [{ prop, actual, expected, unit? }] }.",
      inputSchema: {
        pageUrl: z.string().optional(),
        figmaNodeId: z.string().optional(),
        figmaFileKey: z.string().optional(),
        diffs: z
          .array(z.record(z.any()))
          .describe(
            "Mismatched nodes: [{ selector, figmaNodeId?, figmaName?, issues: [{ prop, actual, expected, unit? }] }]",
          ),
      },
    },
    async (args) => {
      const data = await sendToExtension("show_design_diffs", args);
      return toolText(data);
    },
  );

  mcpServer.registerTool(
    "get_network_requests",
    {
      description: "Get cached fetch/XHR captures for a tab (from extension net capture).",
      inputSchema: {
        tabId: z.number().int().optional(),
        urlPattern: z.string().optional().describe("Filter by URL substring"),
        limit: z.number().int().optional().describe("Default 50"),
      },
    },
    async ({ tabId, urlPattern, limit }) => {
      const data = await sendToExtension("get_network_requests", {
        tabId,
        urlPattern,
        limit,
      });
      return toolText(data);
    },
  );

  return mcpServer;
}

async function main() {
  startWebSocketServer();

  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  log("MCP stdio server started");
}

main().catch((error) => {
  log("Fatal error:", error?.message || String(error));
  process.exit(1);
});
