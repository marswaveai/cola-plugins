import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { GatewayContext, ChannelStatusResult } from "@marswave/cola-plugin-sdk";
import type { ObsidianState, ObsidianMessage } from "./types.js";
import { bindConnections, unbindConnections } from "./outbound.js";

const TOKEN_DIR = join(homedir(), ".cola", "plugins", "obsidian");
const TOKEN_FILE = join(TOKEN_DIR, "local-token");

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function writeTokenFile(token: string): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
}

export async function startLocalServer(
  ctx: GatewayContext<ObsidianState>
): Promise<void> {
  const port = Number(ctx.config.port) || 19533;
  const token = generateToken();
  ctx.state.token = token;
  writeTokenFile(token);

  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  ctx.state.server = wss;
  bindConnections(ctx.state.connections);

  ctx.logger.info(`Obsidian WS server listening on 127.0.0.1:${port}`);

  wss.on("connection", (ws: WebSocket, req) => {
    // Authenticate
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const clientToken = url.searchParams.get("token");

    if (clientToken !== token) {
      ctx.logger.warn("Obsidian client rejected: invalid token");
      ws.close(4001, "Unauthorized");
      return;
    }

    const connId = randomBytes(8).toString("hex");
    ctx.state.connections.set(connId, ws);
    ctx.logger.info(`Obsidian client connected: ${connId}`);

    // Auto-bind identity (token auth already proves local user)
    const senderId = `obsidian:${connId}`;
    ctx.runtime.identity.bind(senderId).catch((err) => {
      ctx.logger.warn(`Failed to auto-bind ${senderId}`, err);
    });

    // Send welcome
    ws.send(
      JSON.stringify({
        type: "connected",
        message: "Connected to Cola",
        connId,
      })
    );

    ws.on("message", async (raw: Buffer) => {
      try {
        const data: ObsidianMessage = JSON.parse(raw.toString());

        // Handle vault info (sent on connect, not a user message)
        if (data.type === "vault-info") {
          ctx.logger.info(`Received vault info: ${data.vaultName}, ${data.vaultFiles?.length || 0} files`);
          // Store vault info in state for context
          (ctx.state as any).vaultFiles = data.vaultFiles;
          (ctx.state as any).vaultName = data.vaultName;
          return;
        }

        if (data.type !== "message") {
          ctx.logger.warn(`Unknown message type: ${(data as any).type}`);
          return;
        }

        // Build message text with file context
        let messageText = data.text;
        const parts: string[] = [];

        // Add vault context on first message or when vault files are available
        const vaultFiles = (ctx.state as any).vaultFiles as string[] | undefined;
        const vaultName = (ctx.state as any).vaultName as string | undefined;
        if (vaultFiles && vaultFiles.length > 0) {
          parts.push(`[Obsidian Vault: ${vaultName || "unknown"}]`);
          parts.push(`[Vault 文件列表 (${vaultFiles.length} 个文件):]`);
          parts.push(vaultFiles.join("\n"));
          parts.push("");
          // Only send file list on first message, then clear
          (ctx.state as any).vaultFiles = null;
        }

        if (data.context && data.context.content) {
          parts.push(`[当前打开的文件: ${data.context.filePath}]`);
          parts.push("---文件内容---");
          parts.push(data.context.content.slice(0, 10000));
          parts.push("---文件内容结束---");
          parts.push("");
        }

        parts.push(data.text);
        messageText = parts.length > 1 ? parts.join("\n") : data.text;

        // Add instruction about vault actions
        messageText += "\n\n[系统提示: 如果用户要求打开/创建文件，请在回复末尾加上操作指令，格式: <!--cola-action:{\"type\":\"openFile\",\"path\":\"文件路径\"}-->\n支持的操作: openFile(打开文件), createFile(创建文件，需要path和content), searchFile(搜索文件，需要query)]";

        // Deliver to Cola
        await ctx.deliver({
          sessionId: ["obsidian", connId],
          sender: {
            id: `obsidian:${connId}`,
            name: "Obsidian User",
          },
          deliveryContext: {
            to: `obsidian:${connId}`,
            threadId: connId,
          },
          message: messageText,
        });
      } catch (err) {
        ctx.logger.error("Failed to process Obsidian message", err);
      }
    });

    ws.on("close", () => {
      ctx.state.connections.delete(connId);
      ctx.logger.info(`Obsidian client disconnected: ${connId}`);
    });

    ws.on("error", (err) => {
      ctx.logger.error(`Obsidian WS error (${connId})`, err);
      ctx.state.connections.delete(connId);
    });
  });

  wss.on("error", (err) => {
    ctx.logger.error("Obsidian WS server error", err);
  });

  // Handle abort signal for graceful shutdown
  ctx.abortSignal.addEventListener("abort", () => {
    wss.close();
  });
}

export async function stopLocalServer(
  ctx: GatewayContext<ObsidianState>
): Promise<void> {
  if (ctx.state.server) {
    // Close all connections
    for (const [id, ws] of ctx.state.connections) {
      ws.close(1000, "Server shutting down");
    }
    ctx.state.server.close();
    ctx.state.server = undefined;
  }
  unbindConnections();
}

export function getServerStatus(
  ctx: GatewayContext<ObsidianState>
): ChannelStatusResult {
  if (!ctx.state.server) {
    return {
      connected: false,
      configured: true,
      message: "Server not running",
    };
  }

  const count = ctx.state.connections.size;
  return {
    connected: count > 0,
    configured: true,
    message:
      count > 0
        ? `${count} Obsidian client(s) connected`
        : "Waiting for Obsidian connection",
  };
}
