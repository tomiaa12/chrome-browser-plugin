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
        "Push Figma-vs-page compare result to the Chrome extension: opens the toolbox「Figma 比对」tab (not a new browser window) with sl-image-comparer + property diffs. Requires「设为 MCP 目标页」. Always pass figmaImageBase64 + pageImageBase64. After calling, tell the user to view the extension toolbox — do NOT dump a markdown table in chat.",
      inputSchema: {
        pageUrl: z.string().optional(),
        figmaNodeId: z.string().optional(),
        figmaFileKey: z.string().optional(),
        figmaImageBase64: z
          .string()
          .optional()
          .describe("Figma frame screenshot base64 (from Figma get_screenshot); data: URL prefix optional"),
        pageImageBase64: z
          .string()
          .optional()
          .describe("Page screenshot base64 from screenshot_design_width.pngBase64"),
        diffs: z
          .array(z.record(z.any()))
          .describe(
            "Mismatched nodes: [{ selector, figmaNodeId?, figmaName?, issues: [{ prop, actual, expected, unit? }] }]",
          ),
      },
    },
    async (args) => {
      const resolved = await resolveLocalFileFields(args, [
        "figmaImageBase64",
        "pageImageBase64",
      ]);
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
        "Get cached fetch/XHR captures for the pinned MCP target tab. Requires「设为 MCP 目标页」first.",
      inputSchema: {
        urlPattern: z.string().optional().describe("Filter by URL substring"),
        limit: z.number().int().optional().describe("Default 50"),
      },
    },
    async ({ urlPattern, limit }) => {
      const data = await sendToExtension("get_network_requests", {
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
