import type * as lark from '@larksuiteoapi/node-sdk'
import { createLarkWSClient } from '../api/client.js'
import type { FeishuAccountConfig } from '../api/types.js'
import type { PluginLogger } from '@marswave/cola-plugin-sdk'

export type WSGatewayHandle = {
  wsClient: lark.WSClient
  cleanup: () => void
}

/**
 * Start a WebSocket gateway for a Feishu account.
 */
export function startWSGateway(
  accountId: string,
  config: FeishuAccountConfig,
  eventDispatcher: lark.EventDispatcher,
  abortSignal: AbortSignal,
  logger: PluginLogger,
): WSGatewayHandle {
  logger.info(`feishu[${accountId}]: starting WebSocket connection...`)

  const wsClient = createLarkWSClient(config)
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    try {
      wsClient.close()
    } catch (err) {
      logger.warn(`feishu[${accountId}]: error closing WebSocket`, err)
    }
  }

  const handleAbort = () => {
    logger.info(`feishu[${accountId}]: abort signal received, stopping WS`)
    cleanup()
  }

  if (abortSignal.aborted) {
    cleanup()
  } else {
    abortSignal.addEventListener('abort', handleAbort, { once: true })
    void wsClient.start({ eventDispatcher })
    logger.info(`feishu[${accountId}]: WebSocket client started`)
  }

  return { wsClient, cleanup }
}
