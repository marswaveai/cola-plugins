import type { AuthContext, PluginLogger, PluginRuntime } from "@marswave/cola-plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("@larksuiteoapi/node-sdk", () => ({ registerApp: vi.fn() }));

import { registerApp } from "@larksuiteoapi/node-sdk";
import { createFeishuAuth } from "../src/auth/login.js";

const mockedRegisterApp = registerApp as unknown as ReturnType<typeof vi.fn>;

function makeLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeCtx(overrides: { accounts?: Record<string, unknown> } = {}) {
  const onQrCode = vi.fn();
  const onStatus = vi.fn();
  const patch = vi.fn(async () => {});
  const bind = vi.fn(async () => {});
  const runtime = {
    config: { get: () => ({}), patch },
    identity: { resolve: vi.fn(async () => null), bind, unbind: vi.fn(async () => {}) },
  } as unknown as PluginRuntime;
  const ctx = {
    config: { accounts: overrides.accounts },
    runtime,
    logger: makeLogger(),
    onQrCode,
    onStatus,
  } as AuthContext;
  return { ctx, onQrCode, onStatus, patch, bind };
}

describe("createFeishuAuth().login (one-click app creation)", () => {
  it("forwards QR/status, writes credentials back, and binds the registering user", async () => {
    mockedRegisterApp.mockImplementation(async (opts: Parameters<typeof registerApp>[0]) => {
      opts.onQRCodeReady({ url: "https://feishu/qr", expireIn: 300 });
      opts.onStatusChange?.({ status: "polling" });
      return {
        client_id: "cli_new",
        client_secret: "secret_new",
        user_info: { open_id: "ou_owner", tenant_brand: "lark" },
      };
    });

    const { ctx, onQrCode, onStatus, patch, bind } = makeCtx({
      accounts: { other: { appId: "cli_other", appSecret: "s" } },
    });

    await createFeishuAuth().login(ctx);

    expect(onQrCode).toHaveBeenCalledWith("https://feishu/qr", "https://feishu/qr");
    expect(onStatus).toHaveBeenCalledWith("polling");
    expect(onStatus).toHaveBeenCalledWith("success", expect.any(String));

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({
      accounts: {
        other: { appId: "cli_other", appSecret: "s" },
        default: { appId: "cli_new", appSecret: "secret_new", domain: "lark" },
      },
    });

    expect(bind).toHaveBeenCalledWith("ou_owner");
  });

  it("disconnect clears all accounts via config.patch and binds nobody", async () => {
    const { ctx, patch, bind } = makeCtx({
      accounts: { default: { appId: "cli_old", appSecret: "s" } },
    });

    await createFeishuAuth().disconnect!(ctx);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ accounts: {} });
    expect(bind).not.toHaveBeenCalled();
  });

  it("defaults domain to feishu and skips bind when no user_info is returned", async () => {
    mockedRegisterApp.mockImplementation(async (opts: Parameters<typeof registerApp>[0]) => {
      opts.onQRCodeReady({ url: "https://feishu/qr2", expireIn: 120 });
      return { client_id: "cli_a", client_secret: "secret_a" };
    });

    const { ctx, patch, bind } = makeCtx();

    await createFeishuAuth().login(ctx);

    expect(patch).toHaveBeenCalledWith({
      accounts: { default: { appId: "cli_a", appSecret: "secret_a", domain: "feishu" } },
    });
    expect(bind).not.toHaveBeenCalled();
  });
});
