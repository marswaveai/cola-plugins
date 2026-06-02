import type { PluginLogger, PluginRuntime } from "@marswave/cola-plugin-sdk";
import type { FeishuAccountConfig } from "../api/types.js";

export function parseAuthorizedOpenIds(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.filter((item): item is string => isNonEmptyString(item)).map(trim));
  }

  if (typeof value !== "string") return new Set();

  return new Set(
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function getAuthorizedOpenIds(config: FeishuAccountConfig): Set<string> {
  return parseAuthorizedOpenIds(config.authorizedOpenIds);
}

export async function authorizeOpenId(
  identity: PluginRuntime["identity"],
  authorizedOpenIds: Set<string>,
  senderId: string,
  logger: PluginLogger,
): Promise<boolean> {
  if (await identity.resolve(senderId)) return true;
  if (!authorizedOpenIds.has(senderId)) return false;

  await identity.bind(senderId);
  logger.info(`Bound Feishu sender ${senderId} from authorized open_id list`);

  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function trim(value: string): string {
  return value.trim();
}
