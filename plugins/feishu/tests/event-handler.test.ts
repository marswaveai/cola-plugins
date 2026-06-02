import type * as lark from "@larksuiteoapi/node-sdk";
import type { DeliverFn, PluginLogger, PluginRuntime } from "@marswave/cola-plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { registerMessageHandler } from "../src/gateway/event-handler.js";
import { MessageDedup } from "../src/gateway/dedup.js";
import type { ChatMap } from "../src/gateway/chat-map.js";

type Handler = (data: FeishuMessageData) => Promise<Record<string, never>>;

type FeishuMessageData = {
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: unknown[];
  };
  sender: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type: string;
  };
};

function makeLogger(): PluginLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
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

function message(openId: string): FeishuMessageData {
  return {
    message: {
      message_id: "m1",
      chat_id: "chat1",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
    },
    sender: {
      sender_id: { open_id: openId },
      sender_type: "user",
    },
  };
}

function groupMessage(openId: string): FeishuMessageData {
  const event = message(openId);
  return {
    ...event,
    message: {
      ...event.message,
      chat_id: "group-chat1",
      chat_type: "group",
    },
  };
}

function register(opts: {
  authorizedOpenIds?: Set<string>;
  resolve?: (senderId: string) => Promise<string | null>;
}) {
  const { dispatcher, handlers } = makeDispatcher();
  const bind = vi.fn(async () => {});
  const resolve = vi.fn(opts.resolve ?? (async () => null));
  const logger = makeLogger();
  const deliver = vi.fn(async () => {}) as unknown as DeliverFn;
  const chatMap = { set: vi.fn() } as unknown as ChatMap;
  const create = vi.fn(async () => {});
  const client = { im: { message: { create } } } as unknown as lark.Client;

  registerMessageHandler(dispatcher, {
    client,
    accountId: "default",
    logger,
    deliver,
    identity: { resolve, bind, unbind: vi.fn() } as PluginRuntime["identity"],
    authorizedOpenIds: opts.authorizedOpenIds ?? new Set(),
    dedup: new MessageDedup(),
    chatMap,
  });

  return { handler: handlers["im.message.receive_v1"], bind, resolve, deliver, chatMap, create };
}

describe("Feishu message identity binding", () => {
  it("replies with unsupported notice for group chats without delivery or binding", async () => {
    const { handler, bind, resolve, deliver, chatMap, create } = register({
      authorizedOpenIds: new Set(["ou_allowed"]),
    });

    await handler(groupMessage("ou_allowed"));

    expect(resolve).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(chatMap.set).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { receive_id_type: "chat_id" },
        data: expect.objectContaining({
          receive_id: "group-chat1",
          msg_type: "post",
          content: expect.stringContaining("暂不支持群聊"),
        }),
      }),
    );
  });

  it("binds an authorized unbound sender before delivery", async () => {
    const { handler, bind, resolve, deliver } = register({
      authorizedOpenIds: new Set(["ou_allowed"]),
    });

    await handler(message("ou_allowed"));

    expect(resolve).toHaveBeenCalledWith("ou_allowed");
    expect(bind).toHaveBeenCalledWith("ou_allowed");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: ["chat", "default", "chat1", "sender", "ou_allowed"],
        sender: { id: "ou_allowed" },
        message: "hello",
      }),
    );
  });

  it("does not rebind an already-bound authorized sender", async () => {
    const { handler, bind, deliver } = register({
      authorizedOpenIds: new Set(["ou_allowed"]),
      resolve: async () => "user-1",
    });

    await handler(message("ou_allowed"));

    expect(bind).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("replies with access instructions for senders outside the authorized open_id list", async () => {
    const { handler, bind, resolve, deliver, chatMap, create } = register({
      authorizedOpenIds: new Set(["ou_allowed"]),
    });

    await handler(message("ou_other"));

    expect(resolve).toHaveBeenCalledWith("ou_other");
    expect(bind).not.toHaveBeenCalled();
    expect(chatMap.set).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { receive_id_type: "chat_id" },
        data: expect.objectContaining({
          receive_id: "chat1",
          msg_type: "post",
          content: expect.stringContaining("ou_other"),
        }),
      }),
    );
  });

  it("replies with access instructions when no authorized list is configured", async () => {
    const { handler, bind, deliver, create } = register({});

    await handler(message("ou_unlisted"));

    expect(bind).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("ou_unlisted"),
        }),
      }),
    );
  });

  it("delivers already-bound senders even when they are not in the authorized list", async () => {
    const { handler, bind, deliver, create } = register({
      authorizedOpenIds: new Set(["ou_allowed"]),
      resolve: async () => "user-1",
    });

    await handler(message("ou_other"));

    expect(bind).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
