import type * as lark from '@larksuiteoapi/node-sdk'
import type { PluginLogger, DeliverFn } from 'cola-plugin-sdk'
import type { FeishuAccountConfig } from '../api/types.js'
import { createLarkClient, createEventDispatcher } from '../api/client.js'
import { registerMessageHandler, registerReactionHandler } from './event-handler.js'
import { startWSGateway } from './ws-gateway.js'
import { startWebhookGateway } from './webhook-server.js'
import { MessageDedup } from './dedup.js'
import { ChatMap } from './chat-map.js'

export type MonitorHandle = {
  accountId: string
  client: lark.Client
  chatMap: ChatMap
  cleanup: () => void
}

/**
 * Start monitoring a single Feishu account — sets up client, event dispatcher, and transport.
 */
export function startMonitor(opts: {
  accountId: string
  config: FeishuAccountConfig
  deliver: DeliverFn
  logger: PluginLogger
  abortSignal: AbortSignal
}): MonitorHandle {
  const { accountId, config, deliver, logger, abortSignal } = opts

  // Create client and dispatcher
  const client = createLarkClient(accountId, config)
  const dispatcher = createEventDispatcher(config)
  const dedup = new MessageDedup()
  const chatMap = new ChatMap(accountId, logger)

  // Register event handler
  registerMessageHandler(dispatcher, {
    client,
    accountId,
    logger,
    deliver,
    dedup,
    chatMap,
  })
  registerReactionHandler(dispatcher, {
    client,
    accountId,
    logger,
    deliver,
    dedup,
    chatMap,
  })

  // Choose transport mode
  const mode = config.connectionMode ?? 'websocket'
  let transportCleanup: () => void

  if (mode === 'webhook') {
    const handle = startWebhookGateway(accountId, config, dispatcher, abortSignal, logger)
    transportCleanup = handle.cleanup
  } else {
    const handle = startWSGateway(accountId, config, dispatcher, abortSignal, logger)
    transportCleanup = handle.cleanup
  }

  logger.info(`feishu[${accountId}]: monitor started (mode=${mode})`)

  return {
    accountId,
    client,
    chatMap,
    cleanup: transportCleanup,
  }
}
