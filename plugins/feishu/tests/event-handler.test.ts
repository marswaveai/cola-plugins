import type * as lark from "@larksuiteoapi/node-sdk";
import type { DeliverFn, PluginLogger } from "@marswave/cola-plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { registerMessageHandler, registerReactionHandler } from "../src/gateway/event-handler.js";
import { MessageDedup } from "../src/gateway/dedup.js";
import type { ChatMap } from "../src/gateway/chat-map.js";

type Handler = (data: FeishuMessageData) => Promise<Record<string, never>>;

type Mention = { key: string; id: { open_id?: string }; name: string };

type FeishuMessageData = {
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Mention[];
  };
  sender: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type: string;
  };
};

function makeLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDispatcher() {
  const handlers: Record<string, Handler> = {};
  const dispatcher = {
    register(events: Record<string, Handler>) {
      Object.assign(handlers, events);
    },
  } as unknown as lark.EventDispatcher;
  return { dispatcher, handlers };
}

function directMessage(openId: string): FeishuMessageData {
  return {
    message: {
      message_id: "m1",
      chat_id: "chat1",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
    },
    sender: { sender_id: { open_id: openId }, sender_type: "user" },
  };
}

function groupMessage(openId: string, mentions?: Mention[]): FeishuMessageData {
  const event = directMessage(openId);
  return {
    ...event,
    message: { ...event.message, chat_id: "group-chat1", chat_type: "group", mentions },
  };
}

function botMention(botOpenId: string): Mention {
  return { key: "@_user_1", id: { open_id: botOpenId }, name: "Cola" };
}

function register(opts: { botOpenId?: string } = {}) {
  const { dispatcher, handlers } = makeDispatcher();
  const logger = makeLogger();
  const deliver = vi.fn(async () => {}) as unknown as DeliverFn;
  const chatMap = { set: vi.fn(), get: vi.fn(), hasUser: vi.fn() } as unknown as ChatMap;
  const create = vi.fn(async () => {});
  const client = { im: { message: { create } } } as unknown as lark.Client;

  registerMessageHandler(dispatcher, {
    client,
    accountId: "default",
    logger,
    deliver,
    dedup: new MessageDedup(),
    chatMap,
    botOpenId: opts.botOpenId,
  });

  return { handler: handlers["im.message.receive_v1"], deliver, chatMap, create };
}

describe("Feishu message delivery (SDK access gate)", () => {
  it("delivers a direct message as a direct conversation without any in-plugin reply", async () => {
    const { handler, deliver, chatMap, create } = register();

    await handler(directMessage("ou_alice"));

    expect(create).not.toHaveBeenCalled();
    expect(chatMap.set).toHaveBeenCalledWith("ou_alice", "chat1");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: ["chat", "default", "chat1", "sender", "ou_alice"],
        sender: { id: "ou_alice" },
        conversation: { kind: "direct", id: "ou_alice" },
        mentionedBot: undefined,
        deliveryContext: expect.objectContaining({
          to: "chat:chat1",
          accountId: "default",
          messageId: "m1",
        }),
        message: "hello",
      }),
    );
  });

  it("delivers a group message that @mentions the bot with mentionedBot=true", async () => {
    const { handler, deliver } = register({ botOpenId: "ou_bot" });

    await handler(groupMessage("ou_alice", [botMention("ou_bot")]));

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: ["chat", "default", "group-chat1"],
        sender: { id: "ou_alice" },
        conversation: { kind: "group", id: "group-chat1" },
        mentionedBot: true,
        deliveryContext: expect.objectContaining({ to: "chat:group-chat1" }),
        message: "hello",
      }),
    );
  });

  it("delivers a group message without an @bot mention with mentionedBot=false", async () => {
    const { handler, deliver } = register({ botOpenId: "ou_bot" });

    await handler(groupMessage("ou_alice"));

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: { kind: "group", id: "group-chat1" },
        mentionedBot: false,
      }),
    );
  });

  it("reports mentionedBot=false in groups when the bot open_id is unknown", async () => {
    const { handler, deliver } = register();

    await handler(groupMessage("ou_alice", [botMention("ou_bot")]));

    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ mentionedBot: false }));
  });

  it("skips delivery for an unknown sender", async () => {
    const { handler, deliver } = register();

    await handler({
      message: directMessage("ou_alice").message,
      sender: { sender_type: "user" },
    });

    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips delivery when text is only the bot mention and there are no attachments", async () => {
    const { handler, deliver } = register({ botOpenId: "ou_bot" });
    const event = groupMessage("ou_alice", [botMention("ou_bot")]);
    event.message.content = JSON.stringify({ text: "@_user_1" });

    await handler(event);

    expect(deliver).not.toHaveBeenCalled();
  });
});

type ReactionData = {
  message_id?: string;
  user_id?: { open_id?: string };
  reaction_type?: { emoji_type?: string };
  event_id?: string;
};

describe("Feishu reaction delivery (SDK access gate)", () => {
  it("delivers a reaction as a direct conversation routed to the reacted chat", async () => {
    let handler!: (data: ReactionData) => Promise<unknown>;
    const dispatcher = {
      register(events: Record<string, (data: ReactionData) => Promise<Record<string, never>>>) {
        handler = events["im.message.reaction.created_v1"];
      },
    } as unknown as lark.EventDispatcher;

    const deliver = vi.fn(async () => {}) as unknown as DeliverFn;
    const chatMap = { set: vi.fn(), get: vi.fn(), hasUser: vi.fn() } as unknown as ChatMap;
    const get = vi.fn(async () => ({
      data: {
        items: [
          { chat_id: "chat1", msg_type: "text", body: { content: JSON.stringify({ text: "hi" }) } },
        ],
      },
    }));
    const client = { im: { message: { get } } } as unknown as lark.Client;

    registerReactionHandler(dispatcher, {
      client,
      accountId: "default",
      logger: makeLogger(),
      deliver,
      dedup: new MessageDedup(),
      chatMap,
    });

    await handler({
      message_id: "m9",
      user_id: { open_id: "ou_alice" },
      reaction_type: { emoji_type: "THUMBSUP" },
      event_id: "e1",
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: ["chat", "default", "chat1", "sender", "ou_alice"],
        sender: { id: "ou_alice" },
        conversation: { kind: "direct", id: "ou_alice" },
        deliveryContext: expect.objectContaining({
          to: "chat:chat1",
          accountId: "default",
          messageId: "m9",
        }),
      }),
    );
  });
});
