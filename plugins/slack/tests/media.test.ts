import fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import { downloadSlackFile } from "../src/media.js";

const logger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slack media downloads", () => {
  it("streams private file downloads to disk", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello "));
        controller.enqueue(new TextEncoder().encode("world"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        body,
        arrayBuffer: async () => {
          throw new Error("arrayBuffer should not be used");
        },
      })),
    );

    const filePath = await downloadSlackFile(
      {
        id: "F123",
        name: "note.txt",
        url_private_download: "https://slack.example/files/F123",
      },
      "xoxb-token",
      logger,
    );

    expect(filePath).toBeDefined();
    expect(fs.readFileSync(filePath!, "utf8")).toBe("hello world");
    fs.rmSync(filePath!, { force: true });
  });
});
