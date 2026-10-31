import { describe, expect, it } from "vitest";
import { OWNER_TAG_PREFIX, annotateGroupMessage } from "../src/gateway/event-handler.js";

const OWNER_STAFF_ID = "14580769531227439";

describe("annotateGroupMessage", () => {
  it("tags the owner via senderStaffId even when senderId is a LWCP union id", () => {
    const text = annotateGroupMessage(
      {
        isGroup: true,
        text: "在吗",
        senderId: "$:LWCP_v1:$V2vrYw+vdvNXWD8bhlqdY",
        senderStaffId: OWNER_STAFF_ID,
        senderNick: "韩啸",
      },
      OWNER_STAFF_ID,
    );
    expect(text.startsWith(OWNER_TAG_PREFIX)).toBe(true);
    expect(text).toContain("在吗");
  });

  it("falls back to senderId comparison when senderStaffId is absent", () => {
    const text = annotateGroupMessage(
      { isGroup: true, text: "hi", senderId: OWNER_STAFF_ID, senderNick: "韩啸" },
      OWNER_STAFF_ID,
    );
    expect(text.startsWith(OWNER_TAG_PREFIX)).toBe(true);
  });

  it("tags non-owners with the constraint line (union id does not match staffId)", () => {
    const text = annotateGroupMessage(
      {
        isGroup: true,
        text: "hi",
        senderId: "$:LWCP_v1:$V2vrYw+vdvNXWD8bhlqdY",
        senderStaffId: "someone-else",
        senderNick: "路人",
      },
      OWNER_STAFF_ID,
    );
    expect(text.startsWith(OWNER_TAG_PREFIX)).toBe(false);
    expect(text).toContain("[非所有者消息 · ");
  });

  it("leaves direct-chat text untouched", () => {
    const text = annotateGroupMessage(
      { isGroup: false, text: "hello", senderId: "$:LWCP_v1:$x", senderStaffId: "U1" },
      OWNER_STAFF_ID,
    );
    expect(text).toBe("hello");
  });
});
