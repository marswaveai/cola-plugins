import type { PluginRuntime } from "@marswave/cola-plugin-sdk";
import type * as lark from "@larksuiteoapi/node-sdk";
import type { ChannelStatusResult, PluginLogger, DeliverFn } from "@marswave/cola-plugin-sdk";
import type { FeishuAccountConfig } from "../api/types.js";
import { createLarkClient, createEventDispatcher, fetchBotOpenId } from "../api/client.js";
import { registerMessageHandler, registerReactionHandler } from "./event-handler.js";
import { startWSGateway } from "./ws-gateway.js";
import { MessageDedup } from "./dedup.js";
import { ChatMap } from "./chat-map.js";
import { GroupContextTracker } from "./group-context.js";
import { describeConnectionError } from "./connection-error.js";

export type MonitorHandle = {
  accountId: string;
  client: lark.Client;
  chatMap: ChatMap;
  cleanup: () => void;
  getStatus: () => ChannelStatusResult;
};

/**
 * Start monitoring a single Feishu account — sets up client, event dispatcher, and transport.
 * Authorization is handled by the host SDK access gate, not here.
 */
export async function startMonitor(opts: {
  i18n?: PluginRuntime["i18n"];
  accountId: string;
  config: FeishuAccountConfig;
  deliver: DeliverFn;
  logger: PluginLogger;
  abortSignal: AbortSignal;
  groupEnabled: boolean;
}): Promise<MonitorHandle> {
  const { accountId, config, deliver, logger, abortSignal, groupEnabled } = opts;
  abortSignal.throwIfAborted();

  // Create client and dispatcher
  const client = createLarkClient(accountId, config);
  const dispatcher = createEventDispatcher(config);
  const dedup = new MessageDedup();
  const chatMap = new ChatMap(accountId, logger);
  const groupContext = new GroupContextTracker();

  // Bot open_id is required to detect @bot mentions in group chats.
  let botOpenId: string | undefined;
  let initialError: string | undefined;
  try {
    botOpenId = await fetchBotOpenId(client);
  } catch (err) {
    initialError = describeConnectionError(err);
    logger.warn(`feishu[${accountId}]: Failed to fetch bot open_id: ${initialError}`);
  }
  abortSignal.throwIfAborted();

  const deps = {
    client,
    i18n: opts.i18n,
    accountId,
    logger,
    deliver,
    dedup,
    chatMap,
    groupContext,
    botOpenId,
    groupEnabled,
  };

  // Register event handlers
  registerMessageHandler(dispatcher, deps);
  registerReactionHandler(dispatcher, deps);

  const handle = startWSGateway(accountId, config, dispatcher, abortSignal, logger, initialError);

  logger.info(`feishu[${accountId}]: monitor started (mode=websocket)`);

  return {
    accountId,
    client,
    chatMap,
    cleanup: handle.cleanup,
    getStatus: handle.getStatus,
  };
}
