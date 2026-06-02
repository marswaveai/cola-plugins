import type { PluginLogger, PluginRuntime } from "@marswave/cola-plugin-sdk";

/**
 * Parse a legacy `authorizedOpenIds` config value (comma/space separated string
 * or array) into a set of open_ids. Retained only to migrate pre-SDK-gate config.
 */
export function parseAuthorizedOpenIds(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(
      value.filter((item): item is string => isNonEmptyString(item)).map((s) => s.trim()),
    );
  }

  if (typeof value !== "string") return new Set();

  return new Set(
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * One-time migration: bind every legacy `authorizedOpenIds` entry as an identity
 * binding so existing authorized users keep access under the SDK access gate.
 * Idempotent — re-binding an already-bound sender is a no-op on the host side.
 */
export async function migrateLegacyAllowlist(
  accounts: Iterable<{ authorizedOpenIds?: unknown }>,
  identity: PluginRuntime["identity"],
  logger: PluginLogger,
): Promise<void> {
  const seen = new Set<string>();
  for (const acct of accounts) {
    for (const openId of parseAuthorizedOpenIds(acct.authorizedOpenIds)) {
      if (seen.has(openId)) continue;
      seen.add(openId);
      await identity.bind(openId);
    }
  }
  if (seen.size > 0) {
    logger.info(`Migrated ${seen.size} legacy authorizedOpenId(s) to identity bindings`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
