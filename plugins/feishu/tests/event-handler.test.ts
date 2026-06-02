import type * as lark from "@larksuiteoapi/node-sdk";
import type { DeliverFn, PluginLogger } from "@marswave/cola-plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { registerMessageHandler, registerReactionHandler } from "../src/gateway/event-handler.js";
import { MessageDedup } from "../src/gateway/dedup.js";
import type { ChatMap } from "../src/gateway/chat-map.js";
import { GroupContextTracker } from "../src/gateway/group-context.js";

type Handler = (data: FeishuMessageData) => Promise<Record<string, never>>;

type Mention = { key: string; id: { open_id?: string }; name: string };

type FeishuMessageData = {
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    create_time?: string;
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

function register(opts: { botOpenId?: string; list?: ReturnType<typeof vi.fn> } = {}) {
  const { dispatcher, handlers } = makeDispatcher();
  const logger = makeLogger();
  const deliver = vi.fn(async () => {}) as unknown as DeliverFn;
  const chatMap = { set: vi.fn(), get: vi.fn(), hasUser: vi.fn() } as unknown as ChatMap;
  const create = vi.fn(async () => {});
  const list = opts.list ?? vi.fn(async () => ({ data: { items: [] } }));
  const client = { im: { message: { create, list } } } as unknown as lark.Client;

  registerMessageHandler(dispatcher, {
    client,
    accountId: "default",
    logger,
    deliver,
    dedup: new MessageDedup(),
    chatMap,
    groupContext: new GroupContextTracker(),
    botOpenId: opts.botOpenId,
  });

  return { handler: handlers["im.message.receive_v1"], deliver, chatMap, create, list };
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

  it("prepends fetched group context for a group @mention", async () => {
    const list = vi.fn(async () => ({
      data: {
        items: [
          {
            message_id: "ctx1",
            msg_type: "text",
            sender: { id: "ou_a", sender_type: "user" },
            body: { content: JSON.stringify({ text: "几点开会" }) },
          },
        ],
      },
    }));
    const { handler, deliver } = register({ botOpenId: "ou_bot", list });
    const event = groupMessage("ou_alice", [botMention("ou_bot")]);
    event.message.message_id = "trigger";
    event.message.create_time = "60000";

    await handler(event);

    expect(list).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    const payload = (deliver as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.mentionedBot).toBe(true);
    expect(payload.message).toContain("[Recent group messages since your last reply");
    expect(payload.message).toContain("[ou_a] 几点开会");
    expect(payload.message).toContain("[Current message — reply to this]");
  });

  it("uses the prior trigger's time as the start watermark on the next @mention in the same chat", async () => {
    const list = vi.fn(async () => ({ data: { items: [] } }));
    const { handler } = register({ botOpenId: "ou_bot", list });

    const first = groupMessage("ou_alice", [botMention("ou_bot")]);
    first.message.message_id = "trigger1";
    first.message.create_time = "60000";
    await handler(first);

    const second = groupMessage("ou_alice", [botMention("ou_bot")]);
    second.message.message_id = "trigger2";
    second.message.create_time = "120000";
    await handler(second);

    expect(list).toHaveBeenCalledTimes(2);
    // First @ is a cold start: descending window, no start watermark.
    expect(list.mock.calls[0][0].params).toMatchObject({
      sort_type: "ByCreateTimeDesc",
      end_time: "60",
    });
    expect(list.mock.calls[0][0].params).not.toHaveProperty("start_time");
    // Second @ resumes from the first trigger's second (watermark round-trip).
    expect(list.mock.calls[1][0].params).toMatchObject({
      sort_type: "ByCreateTimeAsc",
      start_time: "60",
      end_time: "120",
    });
  });

  it("does not fetch group context for a direct message", async () => {
    const { handler, deliver, list } = register({ botOpenId: "ou_bot" });

    await handler(directMessage("ou_alice"));

    expect(list).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("still delivers without a context block when the fetch fails", async () => {
    const list = vi.fn().mockRejectedValue(new Error("boom"));
    const { handler, deliver } = register({ botOpenId: "ou_bot", list });
    const event = groupMessage("ou_alice", [botMention("ou_bot")]);
    event.message.message_id = "trigger";
    event.message.create_time = "60000";

    await handler(event);

    expect(deliver).toHaveBeenCalledTimes(1);
    const payload = (deliver as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.message).not.toContain("[Recent group messages");
    expect(payload.message).toBe("hello");
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
