import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startMonitor,
  NO_FRAME_TIMEOUT_MS,
  WATCHDOG_CHECK_INTERVAL_MS,
} from "../src/gateway/monitor.js";
import type { DeliverFn, PluginLogger } from "@marswave/cola-plugin-sdk";
import type { DingTalkAccountConfig } from "../src/api/types.js";

// The subset of DWClient the monitor touches, plus the lifecycle counters the
// tests assert on. All credentials are fake; no network is touched.
type CapturedClient = {
  connected: boolean;
  registered: boolean;
  reconnecting: boolean;
  disconnectCount: number;
  onDownStream: (data: string) => void;
};

let capturedClient: CapturedClient | undefined;

vi.mock("dingtalk-stream", () => ({
  TOPIC_ROBOT: "__robot__",
  DWClient: class {
    connected = false;
    registered = false;
    reconnecting = false;
    onDownStream = () => {};
    disconnectCount = 0;
    registerCallbackListener = (_t: string, _c: unknown) => this;
    socketCallBackResponse = () => {};
    getEndpoint = async () => {
      this.connected = true;
      return this;
    };
    _connect = async () => {
      this.connected = true;
    };
    disconnect = () => {
      this.disconnectCount += 1;
      this.connected = false;
    };
    constructor() {
      capturedClient = this as unknown as CapturedClient;
    }
  },
}));

function makeLogger(): PluginLogger & { warns: unknown[] } {
  const warns: unknown[] = [];
  return {
    info: () => {},
    warn: (...args: unknown[]) => {
      warns.push(args[0]);
    },
    error: () => {},
    warns,
  } as PluginLogger & { warns: unknown[] };
}

const fakeConfig: DingTalkAccountConfig = {
  clientId: "cli_test_watchdog",
  clientSecret: "test-secret",
};

async function bootMonitor() {
  capturedClient = undefined;
  const logger = makeLogger();
  const controller = new AbortController();
  const handle = await startMonitor({
    accountId: "default",
    config: fakeConfig,
    deliver: (async () => {}) as DeliverFn,
    logger,
    abortSignal: controller.signal,
    groupEnabled: false,
  });
  // Flush the synchronous connectLoop microtasks (getEndpoint/_connect resolve
  // immediately), so the watchdog gets armed before we start the clock.
  await vi.advanceTimersByTimeAsync(0);
  const client = capturedClient!;
  return { handle, logger, controller, client };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchdog: last-frame dead-connection detection", () => {
  it("forcibly disconnects and reconnects when no frame arrives within the timeout", async () => {
    const { logger, client } = await bootMonitor();
    expect(client.disconnectCount).toBe(0);

    // Keep the socket "open" but push no frames for the full timeout window.
    await vi.advanceTimersByTimeAsync(NO_FRAME_TIMEOUT_MS + WATCHDOG_CHECK_INTERVAL_MS);

    // The watchdog should have broken the dead connection and logged a warning,
    // then the connect loop rebuilt it (socket torn down and re-established).
    expect(client.disconnectCount).toBeGreaterThanOrEqual(1);
    expect(logger.warns.some((w) => String(w).includes("no frames"))).toBe(true);
    expect(client.connected).toBe(true); // reconnected by the loop after the forced break
  });

  it("does not fire while frames keep arriving within the timeout window", async () => {
    const { logger, client } = await bootMonitor();

    // Feed a KEEPALIVE every 3 minutes for well past the timeout; each refresh
    // resets the freshness clock, so the watchdog must stay quiet.
    for (let elapsed = 0; elapsed < NO_FRAME_TIMEOUT_MS * 3; elapsed += 3 * 60_000) {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      client.onDownStream(JSON.stringify({ type: "SYSTEM", headers: { topic: "KEEPALIVE" } }));
    }

    expect(client.disconnectCount).toBe(0);
    expect(logger.warns.some((w) => String(w).includes("no frames"))).toBe(false);
    expect(client.connected).toBe(true);
  });

  it("stops firing after stop/cleanup clears the watchdog", async () => {
    const { handle, logger, client, controller } = await bootMonitor();

    controller.abort(); // triggers cleanup -> stopWatchdog()
    expect(client.disconnectCount).toBe(1); // the teardown call

    // Advance well past the timeout: the watchdog must no longer recycle.
    await vi.advanceTimersByTimeAsync(NO_FRAME_TIMEOUT_MS * 2);
    expect(client.disconnectCount).toBe(1);
    expect(logger.warns.some((w) => String(w).includes("no frames"))).toBe(false);

    handle.cleanup(); // idempotent
    expect(client.disconnectCount).toBe(1);
  });

  it("re-arms the watchdog after a watchdog-initiated reconnect", async () => {
    const { logger, client } = await bootMonitor();

    // First stall -> recycle fires, connectLoop reconnects and re-arms.
    await vi.advanceTimersByTimeAsync(NO_FRAME_TIMEOUT_MS + WATCHDOG_CHECK_INTERVAL_MS);
    expect(client.disconnectCount).toBeGreaterThanOrEqual(1);
    expect(client.connected).toBe(true);

    // Feed a KEEPALIVE so the fresh connection is healthy again.
    client.onDownStream(JSON.stringify({ type: "SYSTEM", headers: { topic: "KEEPALIVE" } }));

    // A second stall must be caught by the (re-armed) watchdog too.
    const before = client.disconnectCount;
    await vi.advanceTimersByTimeAsync(NO_FRAME_TIMEOUT_MS + WATCHDOG_CHECK_INTERVAL_MS);
    expect(client.disconnectCount).toBeGreaterThan(before);
    expect(logger.warns.some((w) => String(w).includes("no frames"))).toBe(true);
  });
});
