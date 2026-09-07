import { describe, expect, it, vi } from "vitest";
import { resolvePluginText } from "@marswave/cola-plugin-sdk";
import { createTelegramCommands } from "../src/commands.js";
import en from "../locales/en.json";
import es from "../locales/es.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import zhCN from "../locales/zh-CN.json";
import zhTW from "../locales/zh-TW.json";

const resources = { en, es, ja, ko, "zh-CN": zhCN, "zh-TW": zhTW };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const command = createTelegramCommands(() => ({
  connected: true,
  me: { id: 123, first_name: "Bot", is_bot: true, username: "example_bot" },
}))[0]!;

describe("translated plugin command replies", () => {
  it.each([
    ["en", "Connected"],
    ["es", "Conectado"],
    ["ja", "接続済み"],
    ["ko", "연결됨"],
    ["zh-CN", "已连接"],
    ["zh-TW", "已連線"],
  ])("renders the status and preserves bot identity in %s", async (language, connected) => {
    const result = await command.execute({ args: "status", config: {}, logger });
    const text = resolvePluginText(JSON.parse(JSON.stringify(result.reply)), resources, language);
    expect(text).toContain(connected);
    expect(text).toContain("@example_bot");
    expect(text).not.toContain("{{");
    expect(text).not.toContain("[object Object]");
  });

  it("localizes configuration and subcommand errors without exposing secrets", async () => {
    const result = await command.execute({
      args: "config",
      config: { botToken: "123456:super-secret-value", allowedChatIds: "1,2" },
      logger,
    });
    const text = resolvePluginText(result.reply, resources, "zh-CN");
    expect(text).toContain("机器人令牌");
    expect(text).not.toContain("super-secret-value");
    const missing = await command.execute({ args: "config", config: {}, logger });
    expect(resolvePluginText(missing.reply, resources, "zh-CN")).toContain("机器人令牌：缺失");
    const unknown = await command.execute({ args: "bogus", config: {}, logger });
    expect(resolvePluginText(unknown.reply, resources, "zh-CN")).toBe(
      "未知子命令：bogus。请使用 status | config。",
    );
  });
});
