import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import { downloadSlackFile } from "../src/media.js";

const logger: PluginLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const file = {
  id: "F123",
  name: "note.txt",
  url_private_download: "https://slack.example/files/F123",
};
let temporary: string;

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "cola-slack-download-test-"));
  vi.spyOn(os, "tmpdir").mockReturnValue(temporary);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(temporary, { recursive: true, force: true });
});

async function downloadedFiles() {
  return readdir(path.join(temporary, "cola-slack")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

describe("slack media downloads", () => {
  it("streams a file exactly at the limit to disk", async () => {
    const fetch = vi.fn(async () => new Response("hello world"));
    vi.stubGlobal("fetch", fetch);
    const result = await downloadSlackFile(file, "xoxb-token", logger, { maxBytes: 11 });
    expect(result).toBeDefined();
    expect(await readFile(result!, "utf8")).toBe("hello world");
    expect(fetch.mock.calls[0]).toEqual([
      file.url_private_download,
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-token" },
        signal: expect.any(AbortSignal),
      }),
    ]);
  });

  it("rejects metadata exceeding the default 100 MiB limit before fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await downloadSlackFile({ ...file, size: 100 * 1024 * 1024 + 1 }, "token", logger),
    ).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(await downloadedFiles()).toEqual([]);
  });

  it("cancels an oversized Content-Length response before writing a file", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-length": "9" },
          }),
      ),
    );
    expect(await downloadSlackFile(file, "token", logger, { maxBytes: 8 })).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(await downloadedFiles()).toEqual([]);
  });

  it.each([undefined, "1"])(
    "bounds streaming bytes with Content-Length %s and removes partial files",
    async (length) => {
      const cancel = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(new Uint8Array(4));
                },
                cancel,
              }),
              { headers: length ? { "content-length": length } : {} },
            ),
        ),
      );
      expect(await downloadSlackFile(file, "token", logger, { maxBytes: 8 })).toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(await downloadedFiles()).toEqual([]);
    },
  );

  it("times out a fetch that never returns headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
          }),
      ),
    );
    expect(await downloadSlackFile(file, "token", logger, { timeoutMs: 20 })).toBeUndefined();
    expect(await downloadedFiles()).toEqual([]);
  });

  it("times out a stalled body and removes its partial file", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(4));
              },
              cancel,
            }),
          ),
      ),
    );
    expect(await downloadSlackFile(file, "token", logger, { timeoutMs: 20 })).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(await downloadedFiles()).toEqual([]);
  });

  it("cancels an in-flight download when its gateway stops", async () => {
    const gateway = new AbortController();
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(4));
                gateway.abort();
              },
              cancel,
            }),
          ),
      ),
    );
    expect(
      await downloadSlackFile(file, "token", logger, { signal: gateway.signal }),
    ).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(await downloadedFiles()).toEqual([]);
  });
});
