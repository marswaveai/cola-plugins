import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginLogger } from "@marswave/cola-plugin-sdk";
import { downloadSlackFile, downloadSlackFiles } from "../src/media.js";

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

describe("slack message attachment budgets", () => {
  const files = [file, { ...file, id: "F456", name: "second.txt" }];

  it("accepts multiple files exactly at the total byte limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("1234")),
    );
    const paths = await downloadSlackFiles(files, "token", logger, { maxBytes: 8 });
    expect(paths).toHaveLength(2);
    expect(await Promise.all(paths.map((name) => readFile(name, "utf8")))).toEqual([
      "1234",
      "1234",
    ]);
  });

  it.each([undefined, "1"])(
    "counts streamed bytes across files with Content-Length %s and removes the whole batch",
    async (length) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("123456", {
              headers: length ? { "content-length": length } : {},
            }),
        ),
      );
      await expect(
        downloadSlackFiles(
          [...files, { ...file, id: "F789" }].map((attachment) => ({ ...attachment, size: 1 })),
          "token",
          logger,
          { maxBytes: 10 },
        ),
      ).rejects.toThrow("Message exceeds the 10 byte attachment limit");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await downloadedFiles()).toEqual([]);
    },
  );

  it("includes streamed bytes from failed downloads in the total budget", async () => {
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (++requests !== 1) return new Response("1234");
        let sent = false;
        return new Response(
          new ReadableStream({
            async pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(new TextEncoder().encode("1234"));
              } else {
                // Let the first chunk reach the file transform before the body fails.
                await new Promise((resolve) => setTimeout(resolve, 0));
                controller.error(new Error("Connection interrupted"));
              }
            },
          }),
        );
      }),
    );
    await expect(downloadSlackFiles(files, "token", logger, { maxBytes: 6 })).rejects.toThrow(
      "Message exceeds the 6 byte attachment limit",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await downloadedFiles()).toEqual([]);
  });

  it("uses the batch deadline for a later stalled file and removes earlier files", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (++requests === 1) return new Response("first file");
        expect(await downloadedFiles()).toHaveLength(1);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial second file"));
              deadline.abort(new DOMException("Message download timed out", "TimeoutError"));
            },
          }),
        );
      }),
    );
    await expect(downloadSlackFiles(files, "token", logger)).rejects.toThrow(
      "Message download timed out",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await downloadedFiles()).toEqual([]);
  });
});

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
  it.each([219, 255, 400])(
    "downloads a file with a %i-byte source name and keeps its extension",
    async (length) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("file contents")),
      );
      const result = await downloadSlackFile(
        { ...file, name: "a".repeat(length - 4) + ".txt" },
        "token",
        logger,
      );
      expect(result).toBeDefined();
      expect(Buffer.byteLength(path.basename(result!))).toBeLessThanOrEqual(255);
      expect(path.extname(result!)).toBe(".txt");
      expect(await readFile(result!, "utf8")).toBe("file contents");
    },
  );

  it.each(["disposition", "mimetype", "filetype"])(
    "accepts HTML identified by %s",
    async (evidence) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("<html>report</html>", {
              headers: {
                "content-type": "text/html; charset=utf-8",
                ...(evidence === "disposition"
                  ? { "content-disposition": 'attachment; filename="report.html"' }
                  : {}),
              },
            }),
        ),
      );
      const result = await downloadSlackFile(
        {
          ...file,
          name: "report.html",
          ...(evidence === "mimetype" ? { mimetype: "text/html" } : {}),
          ...(evidence === "filetype" ? { filetype: "html" } : {}),
        },
        "token",
        logger,
      );
      expect(await readFile(result!, "utf8")).toBe("<html>report</html>");
    },
  );

  it.each(["https://slack.com/signin", "https://example.slack.com/login"])(
    "rejects a login redirect to %s even for a declared HTML file",
    async (url) => {
      const response = new Response("<html>Sign in</html>", {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: url });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      expect(
        await downloadSlackFile({ ...file, mimetype: "text/html" }, "token", logger),
      ).toBeUndefined();
      expect(await downloadedFiles()).toEqual([]);
    },
  );

  it("rejects unexpected HTML without file metadata or an attachment disposition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
      ),
    );
    expect(await downloadSlackFile(file, "token", logger)).toBeUndefined();
    expect(await downloadedFiles()).toEqual([]);
  });
});
