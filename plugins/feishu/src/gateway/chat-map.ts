import fs from "fs";
import path from "path";
import { getPluginDir } from "../auth/accounts.js";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";

/** In-memory open_id → chat_id map with disk persistence per account */
export class ChatMap {
  private map = new Map<string, string>();
  private accountId: string;
  private logger: PluginLogger;

  constructor(accountId: string, logger: PluginLogger) {
    this.accountId = accountId;
    this.logger = logger;
    this.load();
  }

  get(openId: string): string | undefined {
    return this.map.get(openId);
  }

  set(openId: string, chatId: string): void {
    if (this.map.get(openId) === chatId) return;
    this.map.set(openId, chatId);
    this.save();
  }

  /** Return accountId that owns a given openId, or undefined */
  hasUser(openId: string): boolean {
    return this.map.has(openId);
  }

  private filePath(): string {
    return path.join(getPluginDir(), "accounts", `${this.accountId}.chat-map.json`);
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath(), "utf-8");
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(data)) {
        this.map.set(k, v);
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
  }

  private save(): void {
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.map) obj[k] = v;
      fs.writeFileSync(this.filePath(), JSON.stringify(obj, null, 2));
    } catch (err) {
      this.logger.warn(`Failed to persist chat map for ${this.accountId}`, err);
    }
  }
}
