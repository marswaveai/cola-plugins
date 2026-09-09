import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuDomain, FeishuAccountConfig } from "./types.js";

function resolveDomain(domain: FeishuDomain | undefined): lark.Domain | string {
  if (domain === "lark") return lark.Domain.Lark;
  if (domain === "feishu" || !domain) return lark.Domain.Feishu;
  return domain.replace(/\/+$/, "");
}

// Client cache keyed by accountId
const clientCache = new Map<
  string,
  { client: lark.Client; appId: string; appSecret: string; domain?: FeishuDomain }
>();

export function createLarkClient(accountId: string, config: FeishuAccountConfig): lark.Client {
  const { appId, appSecret, domain } = config;
  if (!appId || !appSecret) {
    throw new Error(`Feishu account "${accountId}" missing appId or appSecret`);
  }

  const cached = clientCache.get(accountId);
  if (
    cached &&
    cached.appId === appId &&
    cached.appSecret === appSecret &&
    cached.domain === domain
  ) {
    return cached.client;
  }

  const client = new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: resolveDomain(domain),
  });

  clientCache.set(accountId, { client, appId, appSecret, domain });
  return client;
}

type WSLifecycleOptions = Pick<
  ConstructorParameters<typeof lark.WSClient>[0],
  "logger" | "onReady" | "onError" | "onReconnecting" | "onReconnected"
>;

export function createLarkWSClient(
  config: FeishuAccountConfig,
  lifecycle: WSLifecycleOptions,
): lark.WSClient {
  const { appId, appSecret, domain } = config;
  if (!appId || !appSecret) {
    throw new Error("Feishu WSClient requires appId and appSecret");
  }

  return new lark.WSClient({
    appId,
    appSecret,
    domain: resolveDomain(domain),
    loggerLevel: lark.LoggerLevel.info,
    ...lifecycle,
  });
}

export function createEventDispatcher(config: FeishuAccountConfig): lark.EventDispatcher {
  return new lark.EventDispatcher({
    encryptKey: config.encryptKey ?? "",
    verificationToken: config.verificationToken ?? "",
  });
}

/**
 * Fetch the bot's own open_id (used to detect @bot mentions in group chats).
 */
export async function fetchBotOpenId(client: lark.Client): Promise<string | undefined> {
  const res = (await client.request({
    method: "GET",
    url: "/open-apis/bot/v3/info",
  })) as { bot?: { open_id?: string } };
  return res?.bot?.open_id;
}

export function getLarkClient(accountId: string): lark.Client | undefined {
  return clientCache.get(accountId)?.client;
}

export function clearClientCache(accountId?: string): void {
  if (accountId) {
    clientCache.delete(accountId);
  } else {
    clientCache.clear();
  }
}
