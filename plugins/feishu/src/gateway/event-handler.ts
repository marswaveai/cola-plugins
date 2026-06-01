import type * as lark from "@larksuiteoapi/node-sdk";
import type { PluginLogger, DeliverFn } from "@marswave/cola-plugin-sdk";
import { parseMessage } from "./message-parser.js";
import { stripBotMention } from "../util/mention.js";
import { MessageDedup } from "./dedup.js";
import type { ChatMap } from "./chat-map.js";

export type EventHandlerDeps = {
  client: lark.Client;
  accountId: string;
  logger: PluginLogger;
  deliver: DeliverFn;
  dedup: MessageDedup;
  chatMap: ChatMap;
  botOpenId?: string;
};

type ReactionAction = "created" | "deleted";

type ReactionEventData = {
  event_id?: string;
  uuid?: string;
  event_type?: string;
  message_id?: string;
  reaction_type?: {
    emoji_type?: string;
  };
  user_id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  action_time?: string;
};

type ReactedMessageContext = {
  chatId?: string;
  summary?: string;
};

/**
 * Register the im.message.receive_v1 event handler on a dispatcher.
 */
export function registerMessageHandler(
  dispatcher: lark.EventDispatcher,
  deps: EventHandlerDeps,
): void {
  dispatcher.register({
    "im.message.receive_v1": async (data) => {
      // SDK v1 passes event data flat (not wrapped in .event)
      const { message, sender } = data;
      const { accountId, logger, deliver, dedup, chatMap, client } = deps;

      // Dedup
      if (dedup.isDuplicate(message.message_id)) {
        return {};
      }

      const senderId = sender.sender_id?.open_id;
      if (!senderId) {
        logger.warn("Message missing sender open_id, skipping");
        return {};
      }

      // Record chat mapping
      chatMap.set(senderId, message.chat_id);

      // Parse message content
      const parsed = await parseMessage(
        {
          message: {
            message_id: message.message_id,
            chat_id: message.chat_id,
            chat_type: message.chat_type,
            message_type: message.message_type,
            content: message.content,
            mentions: message.mentions as
              | Array<{
                  key: string;
                  id: { open_id?: string; user_id?: string; union_id?: string };
                  name: string;
                  tenant_key?: string;
                }>
              | undefined,
          },
          sender: {
            sender_id: {
              open_id: senderId,
              user_id: sender.sender_id?.user_id,
              union_id: sender.sender_id?.union_id,
            },
            sender_type: sender.sender_type,
          },
        },
        client,
        logger,
      );

      if (!parsed.text && parsed.attachments.length === 0) {
        return {};
      }

      // Strip @bot mention
      const mentionsForStrip = message.mentions?.map((m: Record<string, unknown>) => ({
        key: m.key as string,
        id: (m.id ?? {}) as { open_id?: string; user_id?: string; union_id?: string },
        name: (m.name ?? "") as string,
      }));
      let text = stripBotMention(parsed.text, mentionsForStrip, deps.botOpenId);

      // Skip empty text after stripping mentions (unless attachments present)
      if (!text.trim() && parsed.attachments.length === 0) {
        return {};
      }

      // Identity resolution and access control live in the host
      // (plugin-host.ts::createDeliverFn) — single source of truth for the
      // trust-on-first-contact pairing policy.
      await deliver({
        sessionId: ["chat", accountId, message.chat_id, "sender", senderId],
        sender: { id: senderId },
        deliveryContext: {
          to: `chat:${message.chat_id}`,
          accountId,
          messageId: message.message_id,
        },
        message: text,
        attachments: parsed.attachments.length > 0 ? parsed.attachments : undefined,
      });

      return {};
    },
  });
}

/**
 * Register message reaction event handlers on a dispatcher.
 */
export function registerReactionHandler(
  dispatcher: lark.EventDispatcher,
  deps: EventHandlerDeps,
): void {
  dispatcher.register({
    "im.message.reaction.created_v1": async (data) => {
      await handleReaction(data, "created", deps);
      return {};
    },
    "im.message.reaction.deleted_v1": async (data) => {
      await handleReaction(data, "deleted", deps);
      return {};
    },
  });
}

async function handleReaction(
  data: ReactionEventData,
  action: ReactionAction,
  deps: EventHandlerDeps,
): Promise<void> {
  const { accountId, logger, deliver, dedup, chatMap, client } = deps;
  const messageId = data.message_id;
  const senderId = data.user_id?.open_id;
  const emojiType = data.reaction_type?.emoji_type;

  if (!messageId) {
    logger.warn("Reaction event missing message_id, skipping");
    return;
  }
  if (!senderId) {
    logger.warn("Reaction event missing user open_id, skipping");
    return;
  }
  if (!emojiType) {
    logger.warn("Reaction event missing emoji_type, skipping");
    return;
  }

  const dedupKey =
    data.event_id ??
    data.uuid ??
    `${action}:${messageId}:${senderId}:${emojiType}:${data.action_time ?? ""}`;
  if (dedup.isDuplicate(dedupKey)) {
    return;
  }

  const context = await resolveReactedMessageContext(client, messageId, logger);
  if (context.chatId) {
    chatMap.set(senderId, context.chatId);
  }

  const verb = action === "created" ? "added" : "removed";
  const summary = context.summary ? `\nReacted message: ${context.summary}` : "";

  await deliver({
    sessionId: context.chatId
      ? ["chat", accountId, context.chatId, "sender", senderId]
      : ["reaction", accountId, messageId, "sender", senderId],
    sender: { id: senderId },
    deliveryContext: {
      to: context.chatId ? `chat:${context.chatId}` : `user:${senderId}`,
      accountId,
      messageId,
    },
    message: `[Feishu reaction ${verb}] emoji=${emojiType} message_id=${messageId}${summary}`,
  });
}

async function resolveReactedMessageContext(
  client: lark.Client,
  messageId: string,
  logger: PluginLogger,
): Promise<ReactedMessageContext> {
  try {
    const result = await client.im.message.get({
      path: { message_id: messageId },
      params: { user_id_type: "open_id" },
    });
    const message = result?.data?.items?.[0];
    return {
      chatId: message?.chat_id,
      summary: summarizeReactedMessage(message),
    };
  } catch (err) {
    logger.warn(`Failed to load reacted message context for ${messageId}`, err);
    return {};
  }
}

function summarizeReactedMessage(
  message:
    | NonNullable<
        NonNullable<Awaited<ReturnType<lark.Client["im"]["message"]["get"]>>["data"]>["items"]
      >[number]
    | undefined,
): string | undefined {
  if (!message) return undefined;
  const msgType = message.msg_type ?? "unknown";
  const text = extractMessageText(message.body?.content);
  if (!text) return `${msgType} message`;
  return `${msgType}: ${truncate(text, 240)}`;
}

function extractMessageText(content: string | undefined): string | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      if ("text" in parsed && typeof parsed.text === "string") {
        return normalizeWhitespace(parsed.text);
      }
      if ("content" in parsed && Array.isArray(parsed.content)) {
        const text = parsed.content
          .flat()
          .map((item) => {
            if (typeof item !== "object" || item === null) return "";
            if ("text" in item && typeof item.text === "string") return item.text;
            if ("user_name" in item && typeof item.user_name === "string")
              return `@${item.user_name}`;
            return "";
          })
          .filter(Boolean)
          .join(" ");
        return text ? normalizeWhitespace(text) : undefined;
      }
    }
  } catch {
    return normalizeWhitespace(content);
  }
  return undefined;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
