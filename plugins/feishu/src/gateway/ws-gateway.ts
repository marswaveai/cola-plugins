import type * as lark from "@larksuiteoapi/node-sdk";
import { createLarkWSClient } from "../api/client.js";
import type { FeishuAccountConfig } from "../api/types.js";
import { pluginMessage as m } from "@marswave/cola-plugin-sdk";
import type { ChannelStatusResult, PluginLogger } from "@marswave/cola-plugin-sdk";
import { describeConnectionError } from "./connection-error.js";

export type WSGatewayHandle = {
  wsClient: lark.WSClient;
  cleanup: () => void;
  getStatus: () => ChannelStatusResult;
};

/**
 * Start a WebSocket gateway for a Feishu account.
 */
export function startWSGateway(
  accountId: string,
  config: FeishuAccountConfig,
  eventDispatcher: lark.EventDispatcher,
  abortSignal: AbortSignal,
  logger: PluginLogger,
  initialError?: string,
): WSGatewayHandle {
  logger.info(`feishu[${accountId}]: starting WebSocket connection...`);

  let cleanedUp = false;
  const errors: string[] = initialError ? [initialError] : [];
  const recordError = (error: unknown) => {
    if (cleanedUp) return;
    const details = describeConnectionError(error);
    if (!errors.includes(details)) {
      // Preserve the initial cause when retries add generic connection failures.
      if (errors.length === 3) errors.splice(1, 1);
      errors.push(details);
    }
    logger.error(`feishu[${accountId}]: ${details}`);
  };
  const ready = () => {
    if (cleanedUp) return;
    errors.length = 0;
    logger.info(`feishu[${accountId}]: WebSocket connected`);
  };
  const wsClient = createLarkWSClient(config, {
    onReady: ready,
    onReconnected: ready,
    onError: recordError,
    onReconnecting: () => {
      if (!cleanedUp && errors.length === 0) {
        errors.push("WebSocket connection closed; reconnecting");
      }
    },
    // Retryable discovery/transport errors are logged without firing onError.
    logger: {
      error: (...args: unknown[]) => recordError(args),
      warn: (...args: unknown[]) =>
        logger.warn(`feishu[${accountId}]: ${describeConnectionError(args)}`),
      info: (...args: unknown[]) =>
        logger.info(`feishu[${accountId}]: ${describeConnectionError(args)}`),
      debug: () => {},
      trace: () => {},
    },
  });

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    abortSignal.removeEventListener("abort", handleAbort);
    try {
      wsClient.close({ force: true });
    } catch (err) {
      logger.warn(`feishu[${accountId}]: error closing WebSocket`, err);
    }
  };

  const handleAbort = () => {
    logger.info(`feishu[${accountId}]: abort signal received, stopping WS`);
    cleanup();
  };

  if (abortSignal.aborted) {
    cleanup();
  } else {
    abortSignal.addEventListener("abort", handleAbort, { once: true });
    try {
      void wsClient.start({ eventDispatcher }).catch(recordError);
    } catch (err) {
      recordError(err);
    }
  }

  return {
    wsClient,
    cleanup,
    getStatus(): ChannelStatusResult {
      const state = cleanedUp ? "idle" : wsClient.getConnectionStatus().state;
      const connected = state === "connected";
      let message = m("status.disconnected", "Disconnected");
      if (connected) {
        message = m("status.connected", "Connected");
      } else if (!cleanedUp) {
        if (state === "reconnecting") {
          message = m("status.reconnecting", "Connection lost; reconnecting…");
        } else if (state === "failed" || errors.length > 0) {
          message = m("status.failed", "Connection failed");
        } else if (state === "connecting") {
          message = m("status.connecting", "Connecting…");
        }
      }
      return {
        connected,
        configured: true,
        message,
        details: connected || cleanedUp ? undefined : errors.join("\n") || undefined,
      };
    },
  };
}
