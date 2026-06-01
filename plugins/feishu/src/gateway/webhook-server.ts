import * as http from "http";
import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuAccountConfig } from "../api/types.js";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";

export type WebhookGatewayHandle = {
  server: http.Server;
  cleanup: () => void;
};

/**
 * Start a Webhook HTTP server for a Feishu account.
 */
export function startWebhookGateway(
  accountId: string,
  config: FeishuAccountConfig,
  eventDispatcher: lark.EventDispatcher,
  abortSignal: AbortSignal,
  logger: PluginLogger,
): WebhookGatewayHandle {
  const port = config.webhookPort ?? 9321;
  const webhookPath = config.webhookPath ?? "/webhook/event";

  logger.info(
    `feishu[${accountId}]: starting Webhook server on port ${port}, path ${webhookPath}...`,
  );

  const server = http.createServer(
    lark.adaptDefault(webhookPath, eventDispatcher, { autoChallenge: true }),
  );

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    server.close();
  };

  const handleAbort = () => {
    logger.info(`feishu[${accountId}]: abort signal received, stopping Webhook server`);
    cleanup();
  };

  if (abortSignal.aborted) {
    cleanup();
  } else {
    abortSignal.addEventListener("abort", handleAbort, { once: true });

    server.listen(port, () => {
      logger.info(`feishu[${accountId}]: Webhook server listening on port ${port}`);
    });

    server.on("error", (err) => {
      logger.error(`feishu[${accountId}]: Webhook server error`, err);
    });
  }

  return { server, cleanup };
}
