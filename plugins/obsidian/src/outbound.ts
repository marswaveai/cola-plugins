import type { WebSocket } from "ws";
import type { OutboundContext } from "@marswave/cola-plugin-sdk";
import type { ObsidianReply, ColaAction } from "./types.js";

/**
 * Module-level reference to the connections map.
 * Set by gateway.start(), used by outbound.sendText().
 */
let connectionsRef: Map<string, WebSocket> = new Map();

export function bindConnections(connections: Map<string, WebSocket>): void {
  connectionsRef = connections;
}

export function unbindConnections(): void {
  connectionsRef = new Map();
}

/**
 * Parse action markers from Cola's reply text.
 * Format: <!--cola-action:{"type":"openFile","path":"..."}-->
 */
function parseActions(text: string): { cleanText: string; actions: ColaAction[] } {
  const actions: ColaAction[] = [];
  const actionRegex = /<!--cola-action:(.*?)-->/g;

  const cleanText = text.replace(actionRegex, (_, json) => {
    try {
      const action = JSON.parse(json) as ColaAction;
      if (action.type) {
        actions.push(action);
      }
    } catch {
      // Invalid JSON, ignore
    }
    return "";
  }).trim();

  return { cleanText, actions };
}

export async function sendReplyToClient(ctx: OutboundContext): Promise<void> {
  if (connectionsRef.size === 0) {
    ctx.logger.error("sendText: no Obsidian clients connected");
    return;
  }

  // Extract connId from deliveryContext.to (format: "obsidian:<connId>")
  const to = ctx.deliveryContext.to;
  const connId = to.startsWith("obsidian:") ? to.slice(9) : to;

  // Try direct match
  let ws = connectionsRef.get(connId);

  // Try threadId
  if (!ws && ctx.deliveryContext.threadId) {
    ws = connectionsRef.get(String(ctx.deliveryContext.threadId));
  }

  // Fallback: send to first connected client (single-user scenario)
  if (!ws) {
    ws = connectionsRef.values().next().value;
  }

  if (!ws || ws.readyState !== 1 /* OPEN */) {
    ctx.logger.error(`sendText: client not reachable (target: ${connId})`);
    return;
  }

  // Parse action markers from text
  const { cleanText, actions } = parseActions(ctx.text);

  const reply: ObsidianReply = {
    type: "reply",
    text: cleanText,
  };

  if (actions.length > 0) {
    reply.actions = actions;
  }

  ws.send(JSON.stringify(reply));
}
