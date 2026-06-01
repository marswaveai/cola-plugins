import type { FeishuMention } from "../api/types.js";

/**
 * Remove @bot mention text from the message.
 * Feishu mentions appear as `@_user_1` keys in text, with a mentions array mapping key → user info.
 * If a mention's open_id matches the bot's open_id, strip it.
 */
export function stripBotMention(
  text: string,
  mentions: FeishuMention[] | undefined,
  botOpenId: string | undefined,
): string {
  if (!mentions?.length || !botOpenId) return text;

  for (const mention of mentions) {
    if (mention.id.open_id === botOpenId) {
      // Replace the mention key (e.g. "@_user_1") with empty string
      text = text.replace(mention.key, "").trim();
    }
  }

  return text;
}
