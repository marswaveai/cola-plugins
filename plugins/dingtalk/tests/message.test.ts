import { describe, expect, it, vi } from "vitest";
import {
  buildSessionTarget,
  parseRobotMessage,
  stripMentionPrefix,
  summarizeMediaMessage,
  summarizeRichText,
  extractMedia,
  richTextContent,
} from "../src/gateway/message.js";
import { MessageDedup } from "../src/gateway/dedup.js";
import {
  downloadRobotMessageMedia,
  MAX_MEDIA_DOWNLOAD_BYTES,
} from "../src/gateway/media-download.js";

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never;

function directPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    conversationId: "cid-test-1",
    conversationType: "1",
    msgId: "msg-test-1",
    msgtype: "text",
    text: { content: "hello cola" },
    senderStaffId: "staff-001",
    senderId: "sender-001",
    senderNick: "Tester",
    robotCode: "ding-test-robot",
    sessionWebhook: "https://oapi.dingtalk.com/robot/send?sessionWebhook=test",
    sessionWebhookExpiredTime: 9999999999999,
    createAt: 1700000000000,
    ...overrides,
  });
}

describe("parseRobotMessage", () => {
  it("parses a direct text message and resolves a staff session target", () => {
    const parsed = parseRobotMessage(directPayload(), logger);
    expect(parsed).toMatchObject({
      text: "hello cola",
      msgId: "msg-test-1",
      isGroup: false,
      conversationId: "cid-test-1",
      senderStaffId: "staff-001",
      robotCode: "ding-test-robot",
    });
    expect(buildSessionTarget(parsed!)).toBe("staff:staff-001");
  });

  it("parses a group message and resolves a conversation session target", () => {
    const parsed = parseRobotMessage(
      directPayload({
        conversationType: "2",
        text: { content: "@机器人 what is up" },
        senderStaffId: "staff-002",
      }),
      logger,
    );
    expect(parsed).toMatchObject({
      text: "what is up",
      isGroup: true,
    });
    expect(buildSessionTarget(parsed!)).toBe("conversation:cid-test-1");
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseRobotMessage("not json", logger)).toBeUndefined();
  });

  it("returns undefined when required identifiers are missing", () => {
    expect(parseRobotMessage(directPayload({ msgId: undefined }), logger)).toBeUndefined();
    expect(parseRobotMessage(directPayload({ conversationId: undefined }), logger)).toBeUndefined();
    expect(
      parseRobotMessage(directPayload({ conversationType: undefined }), logger),
    ).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("accepts already-parsed payloads", () => {
    const parsed = parseRobotMessage({
      conversationType: "1",
      conversationId: "c",
      msgId: "m",
      msgtype: "text",
      text: { content: "hi" },
    });
    expect(parsed?.text).toBe("hi");
  });
});

describe("stripMentionPrefix", () => {
  it("strips the DingTalk @机器人 prefix with a trailing space", () => {
    expect(stripMentionPrefix("@机器人 help me")).toBe("help me");
  });

  it("strips a bare mention with no trailing space", () => {
    expect(stripMentionPrefix("@机器人")).toBe("");
  });

  it("strips a full-width space after the mention", () => {
    expect(stripMentionPrefix("@机器人　help me")).toBe("help me");
  });

  it("returns empty text when the message is only a mention", () => {
    expect(stripMentionPrefix("@机器人")).toBe("");
  });
});

describe("summarizeMediaMessage", () => {
  const base = { conversationType: "2", conversationId: "c", msgId: "m" };

  it("summarizes picture, audio, and video messages", () => {
    expect(summarizeMediaMessage({ ...base, msgtype: "picture" })).toBe("[图片]");
    expect(summarizeMediaMessage({ ...base, msgtype: "audio" })).toBe("[语音]");
    expect(summarizeMediaMessage({ ...base, msgtype: "video" })).toBe("[视频]");
  });

  it("summarizes file messages with the file name when present", () => {
    expect(summarizeMediaMessage({ ...base, msgtype: "file", fileName: "report.pdf" })).toBe(
      "[文件: report.pdf]",
    );
    expect(
      summarizeMediaMessage({ ...base, msgtype: "file", content: { downloadCode: "x" } }),
    ).toBe("[文件]");
  });

  it("extracts inline text from picture-richText messages via the media summary marker", () => {
    expect(
      summarizeMediaMessage({
        ...base,
        msgtype: "richText",
        content: {
          richText: [
            { text: "rich " },
            { text: "body" },
            { type: "picture", downloadCode: "dc-pic" },
          ],
        },
      }),
    ).toBe("[图文] rich body");
    expect(summarizeMediaMessage({ ...base, msgtype: "richText" })).toBe(""); // no picture, no text
  });

  it("falls back to the raw msgtype for unknown types", () => {
    expect(summarizeMediaMessage({ ...base, msgtype: "hologram" })).toBe("[hologram]");
  });
});

describe("richText message handling", () => {
  const base = {
    conversationType: "2",
    conversationId: "c",
    msgId: "m",
    senderStaffId: "staff-1",
    senderId: "sender-1",
    senderNick: "Tester",
    robotCode: "robot-1",
  };

  it("a) picture+text richText extracts the downloadCode and joins the user text", () => {
    const parsed = parseRobotMessage(
      JSON.stringify({
        ...base,
        msgtype: "richText",
        content: {
          richText: [
            { text: "查一下" },
            { text: "这个图" },
            { type: "picture", downloadCode: "dc-img", fileName: "photo.png" },
          ],
        },
      }),
      logger,
    );
    expect(parsed?.text).toBe("[图文] 查一下这个图"); // summarizeRichText
    expect(parsed?.media).toEqual({
      kind: "image",
      downloadCode: "dc-img",
      fileName: "photo.png",
    });
  });

  it("b) pure-text richText has no media and no [图文] marker", () => {
    const parsed = parseRobotMessage(
      JSON.stringify({
        ...base,
        msgtype: "richText",
        content: { richText: [{ text: "纯文字富文本" }] },
      }),
      logger,
    );
    expect(parsed?.text).toBe("纯文字富文本");
    expect(parsed?.media).toBeUndefined();
  });

  it("c) picture-only richText keeps [图文] and still carries the downloadCode", () => {
    const parsed = parseRobotMessage(
      JSON.stringify({
        ...base,
        msgtype: "richText",
        content: {
          richText: [{ type: "picture", downloadCode: "dc-only" }],
        },
      }),
      logger,
    );
    expect(parsed?.text).toBe("[图文]");
    expect(parsed?.media).toEqual({
      kind: "image",
      downloadCode: "dc-only",
      fileName: undefined,
    });
  });

  it("summarizeRichText falls back to plain text when there is no picture node", () => {
    expect(
      summarizeRichText({
        ...base,
        msgtype: "richText",
        content: { richText: [{ text: "  " }, { text: "cap" }] },
      }),
    ).toBe("cap");
  });

  it("richTextContent reads the picture node used by extractMedia", () => {
    expect(
      richTextContent({
        msgtype: "richText",
        content: {
          richText: [{ text: "x" }, { type: "picture", downloadCode: "d" }],
        },
      }),
    ).toEqual([{ text: "x" }, { type: "picture", downloadCode: "d" }]);
  });
});

describe("extractMedia", () => {
  it("extracts downloadCode + fileName from a file message content", () => {
    const media = extractMedia({
      msgtype: "file",
      content: { downloadCode: "dc-1", fileName: "report.pdf" },
    });
    expect(media).toEqual({ kind: "file", downloadCode: "dc-1", fileName: "report.pdf" });
  });

  it("normalizes picture msgtype to an image kind", () => {
    const media = extractMedia({
      msgtype: "picture",
      content: { downloadCode: "dc-img" },
    });
    expect(media?.kind).toBe("image");
    expect(media?.fileName).toBeUndefined();
  });

  it("falls back to the top-level fileName / downloadCode when content lacks them", () => {
    const media = extractMedia({
      msgtype: "file",
      fileName: "note.txt",
    });
    expect(media?.fileName).toBe("note.txt");
  });

  it("normalizes audio to a voice and video to a video kind", () => {
    expect(extractMedia({ msgtype: "audio", content: { downloadCode: "a" } })?.kind).toBe("audio");
    expect(extractMedia({ msgtype: "video", content: { downloadCode: "v" } })?.kind).toBe("video");
  });

  it("returns undefined for text messages", () => {
    expect(extractMedia({ msgtype: "text", text: { content: "hi" } })).toBeUndefined();
  });

  it("extracts the first picture's downloadCode from a richText message", () => {
    const media = extractMedia({
      msgtype: "richText",
      content: {
        richText: [{ text: "hello" }, { type: "picture", downloadCode: "dc-pic" }],
      },
    });
    expect(media).toEqual({ kind: "image", downloadCode: "dc-pic", fileName: undefined });
  });

  it("returns undefined for a richText message without a picture downloadCode", () => {
    expect(
      extractMedia({
        msgtype: "richText",
        content: { richText: [{ text: "only text" }] },
      }),
    ).toBeUndefined();
    expect(extractMedia({ msgtype: "richText" })).toBeUndefined();
  });
});

describe("downloadRobotMessageMedia", () => {
  it("downloads the message and returns the temp path", async () => {
    const downloaded = "/tmp/cola-dingtalk-abc/report.pdf";
    const client = {
      downloadMessageFile: vi.fn(async () => downloaded),
    };
    const parsed = {
      robotCode: "robot-1",
      media: { kind: "file", downloadCode: "dc", fileName: "report.pdf" },
    } as never;
    const info = vi.fn();

    const out = await downloadRobotMessageMedia(client as never, parsed, {
      info,
      warn: vi.fn(),
    } as never);

    expect(out).toBe(downloaded);
    expect(client.downloadMessageFile).toHaveBeenCalledWith("robot-1", "dc", "report.pdf", {
      maxBytes: MAX_MEDIA_DOWNLOAD_BYTES,
    });
    expect(info).toHaveBeenCalled();
  });

  it("falls back to a hashed name (not the downloadCode) when the message has no file name", async () => {
    const client = { downloadMessageFile: vi.fn(async () => "/tmp/x") };
    // A long base64-ish downloadCode that would exceed filesystem name limits.
    const longCode = `mIofN681YE3f_+m+NntqpT_Xb989by3Wk+raappFh6IDZWpC7EkwrPh${"A".repeat(400)}`;
    const parsed = {
      robotCode: "robot-1",
      media: { kind: "image", downloadCode: longCode },
    } as never;

    await downloadRobotMessageMedia(client as never, parsed, {
      info: vi.fn(),
      warn: vi.fn(),
    } as never);

    const mockCall = (client as { downloadMessageFile: ReturnType<typeof vi.fn> })
      .downloadMessageFile.mock.calls[0] as unknown as [
      string,
      string,
      string,
      { maxBytes: number },
    ];
    expect(mockCall[0]).toBe("robot-1");
    expect(mockCall[1]).toBe(longCode);
    expect(mockCall[3].maxBytes).toBe(MAX_MEDIA_DOWNLOAD_BYTES);
    const name = mockCall[2];
    // The generated name must be short, deterministic, extension-bearing, and
    // must NOT contain the raw downloadCode.
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name).toMatch(/^[0-9a-f]{16}\.jpg$/);
    expect(name).not.toContain(longCode);
    // Deterministic: same code → same name.
    await downloadRobotMessageMedia(client as never, parsed, {
      info: vi.fn(),
      warn: vi.fn(),
    } as never);
    expect(
      (client as { downloadMessageFile: ReturnType<typeof vi.fn> }).downloadMessageFile.mock
        .calls[1][2],
    ).toBe(name);
  });

  it("returns undefined when downloadCode or robotCode is missing, without downloading", async () => {
    const client = { downloadMessageFile: vi.fn() };
    const info = vi.fn();
    const warn = vi.fn();

    const out = await downloadRobotMessageMedia(
      client as never,
      { media: { kind: "file", downloadCode: "dc" } } as never,
      { info, warn } as never,
    );

    expect(out).toBeUndefined();
    expect(client.downloadMessageFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("returns undefined and logs a warning when the download fails", async () => {
    const client = {
      downloadMessageFile: vi.fn(async () => {
        throw new Error("download failed");
      }),
    };
    const info = vi.fn();
    const warn = vi.fn();

    const out = await downloadRobotMessageMedia(
      client as never,
      { robotCode: "r", media: { kind: "file", downloadCode: "dc" } } as never,
      { info, warn } as never,
    );

    expect(out).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("MessageDedup (second dedup layer)", () => {
  it("marks the first sighting as fresh and repeats as duplicates", () => {
    const dedup = new MessageDedup();
    expect(dedup.isDuplicate("msg-a")).toBe(false);
    expect(dedup.isDuplicate("msg-a")).toBe(true);
    expect(dedup.isDuplicate("msg-b")).toBe(false);
  });

  it("forgets ids after the TTL expires", () => {
    vi.useFakeTimers();
    try {
      const dedup = new MessageDedup(1000);
      expect(dedup.isDuplicate("msg-a")).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(dedup.isDuplicate("msg-a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
