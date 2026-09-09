export type SlackConfig = {
  botToken: string;
  appToken: string;
  allowedIds: Set<string>;
  ignoreBotMessages: boolean;
  unfurlLinks: boolean;
};

export function readSlackConfig(raw: Readonly<Record<string, unknown>>): SlackConfig {
  return {
    botToken: readString(raw.botToken),
    appToken: readString(raw.appToken),
    allowedIds: parseAllowedIds(raw.allowedIds),
    ignoreBotMessages: readBoolean(raw.ignoreBotMessages, true),
    unfurlLinks: readBoolean(raw.unfurlLinks, false),
  };
}

export function isSlackConfigured(config: SlackConfig): boolean {
  return config.botToken.length > 0 && config.appToken.length > 0;
}

export function redactToken(token: string): string {
  if (!token) return "(missing)";
  if (token.length <= 10) return "***";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseAllowedIds(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}
