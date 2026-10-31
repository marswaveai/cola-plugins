import type { DingTalkAccountConfig, DingTalkPluginConfig } from "../api/types.js";

export function parseAccountConfigs(
  config: DingTalkPluginConfig,
): Map<string, DingTalkAccountConfig> {
  const accounts = new Map<string, DingTalkAccountConfig>();
  const raw = config.accounts;
  if (!raw || typeof raw !== "object") return accounts;

  for (const [id, acctConfig] of Object.entries(raw)) {
    if (!acctConfig || typeof acctConfig !== "object") continue;
    const cfg = acctConfig as DingTalkAccountConfig;
    if (!cfg.clientId || !cfg.clientSecret) continue;
    if (cfg.enabled === false) continue;
    accounts.set(id, cfg);
  }

  return accounts;
}
