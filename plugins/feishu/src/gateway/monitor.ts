import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger, DeliverFn, PluginRuntime } from "@marswave/cola-plugin-sdk";
import type { FeishuAccountConfig } from "../api/types.js";
import { createLarkClient, createEventDispatcher } from "../api/client.js";
import { registerMessageHandler, registerReactionHandler } from "./event-handler.js";
import { startWSGateway } from "./ws-gateway.js";
import { MessageDedup } from "./dedup.js";
import { ChatMap } from "./chat-map.js";
import { getAuthorizedOpenIds } from "../auth/authorized-open-ids.js";

export type MonitorHandle = {
  accountId: string;
  client: lark.Client;
  chatMap: ChatMap;
  cleanup: () => void;
};

/**
 * Start monitoring a single Feishu account — sets up client, event dispatcher, and transport.
 */
export function startMonitor(opts: {
  accountId: string;
  config: FeishuAccountConfig;
  deliver: DeliverFn;
  identity: PluginRuntime["identity"];
  logger: PluginLogger;
  abortSignal: AbortSignal;
}): MonitorHandle {
  const { accountId, config, deliver, identity, logger, abortSignal } = opts;

  // Create client and dispatcher
  const client = createLarkClient(accountId, config);
  const dispatcher = createEventDispatcher(config);
  const dedup = new MessageDedup();
  const chatMap = new ChatMap(accountId, logger);
  const authorizedOpenIds = getAuthorizedOpenIds(config);

  // Register event handler
  registerMessageHandler(dispatcher, {
    client,
    accountId,
    logger,
    deliver,
    identity,
    authorizedOpenIds,
    dedup,
    chatMap,
  });
  registerReactionHandler(dispatcher, {
    client,
    accountId,
    logger,
    deliver,
    identity,
    authorizedOpenIds,
    dedup,
    chatMap,
  });

  const handle = startWSGateway(accountId, config, dispatcher, abortSignal, logger);

  logger.info(`feishu[${accountId}]: monitor started (mode=websocket)`);

  return {
    accountId,
    client,
    chatMap,
    cleanup: handle.cleanup,
  };
}
