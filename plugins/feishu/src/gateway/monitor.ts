import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger, DeliverFn } from "@marswave/cola-plugin-sdk";
import type { FeishuAccountConfig } from "../api/types.js";
import { createLarkClient, createEventDispatcher, fetchBotOpenId } from "../api/client.js";
import { registerMessageHandler, registerReactionHandler } from "./event-handler.js";
import { startWSGateway } from "./ws-gateway.js";
import { MessageDedup } from "./dedup.js";
import { ChatMap } from "./chat-map.js";
import { GroupContextTracker } from "./group-context.js";

export type MonitorHandle = {
  accountId: string;
  client: lark.Client;
  chatMap: ChatMap;
  cleanup: () => void;
};

/**
 * Start monitoring a single Feishu account — sets up client, event dispatcher, and transport.
 * Authorization is handled by the host SDK access gate, not here.
 */
export async function startMonitor(opts: {
  accountId: string;
  config: FeishuAccountConfig;
  deliver: DeliverFn;
  logger: PluginLogger;
  abortSignal: AbortSignal;
}): Promise<MonitorHandle> {
  const { accountId, config, deliver, logger, abortSignal } = opts;

  // Create client and dispatcher
  const client = createLarkClient(accountId, config);
  const dispatcher = createEventDispatcher(config);
  const dedup = new MessageDedup();
  const chatMap = new ChatMap(accountId, logger);
  const groupContext = new GroupContextTracker();

  // Bot open_id is required to detect @bot mentions in group chats.
  const botOpenId = await fetchBotOpenId(client, logger);

  const deps = { client, accountId, logger, deliver, dedup, chatMap, groupContext, botOpenId };

  // Register event handlers
  registerMessageHandler(dispatcher, deps);
  registerReactionHandler(dispatcher, deps);

  const handle = startWSGateway(accountId, config, dispatcher, abortSignal, logger);

  logger.info(`feishu[${accountId}]: monitor started (mode=websocket)`);

  return {
    accountId,
    client,
    chatMap,
    cleanup: handle.cleanup,
  };
}
