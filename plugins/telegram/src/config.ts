export type TelegramConfig = {
  botToken: string;
  pollingTimeoutSeconds: number;
  pollIntervalMs: number;
  allowedChatIds: Set<string>;
  dropPendingUpdates: boolean;
  ignoreBotMessages: boolean;
  groupEnabled: boolean;
};

export function readTelegramConfig(raw: Readonly<Record<string, unknown>>): TelegramConfig {
  return {
    botToken: readString(raw.botToken),
    pollingTimeoutSeconds: readNumber(raw.pollingTimeoutSeconds, 25, 1, 50),
    pollIntervalMs: readNumber(raw.pollIntervalMs, 250, 0, 60_000),
    allowedChatIds: parseChatIds(raw.allowedChatIds),
    dropPendingUpdates: readBoolean(raw.dropPendingUpdates, false),
    ignoreBotMessages: readBoolean(raw.ignoreBotMessages, true),
    groupEnabled: readBoolean(raw.groupEnabled, false),
  };
}

export function isTelegramConfigured(config: TelegramConfig): boolean {
  return config.botToken.length > 0 && config.allowedChatIds.size > 0;
}

export function redactToken(token: string): string {
  if (!token) return "(missing)";
  if (token.length <= 10) return "***";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseChatIds(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}
