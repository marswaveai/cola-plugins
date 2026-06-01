import fs from "fs";
import path from "path";
import os from "os";
import type { FeishuPluginConfig, FeishuAccountConfig } from "../api/types.js";

let pluginDir = "";

export function setPluginDir(dir: string): void {
  pluginDir = dir;
  fs.mkdirSync(path.join(dir, "accounts"), { recursive: true });
}

export function getPluginDir(): string {
  return pluginDir;
}

export function resolvePluginDir(config: FeishuPluginConfig): string {
  return config.pluginDir ?? path.join(os.homedir(), ".cola", "channels", "feishu");
}

export function parseAccountConfigs(config: FeishuPluginConfig): Map<string, FeishuAccountConfig> {
  const accounts = new Map<string, FeishuAccountConfig>();
  const raw = config.accounts;
  if (!raw || typeof raw !== "object") return accounts;

  for (const [id, acctConfig] of Object.entries(raw)) {
    if (!acctConfig || typeof acctConfig !== "object") continue;
    const cfg = acctConfig as FeishuAccountConfig;
    if (!cfg.appId || !cfg.appSecret) continue;
    if (cfg.enabled === false) continue;
    accounts.set(id, cfg);
  }

  return accounts;
}
