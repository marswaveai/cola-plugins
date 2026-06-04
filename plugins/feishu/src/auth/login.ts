import { registerApp } from "@larksuiteoapi/node-sdk";
import type { AuthContext, ChannelAuthAdapter } from "@marswave/cola-plugin-sdk";

/**
 * One-click Feishu app creation. `cola channel login feishu` triggers the RFC 8628
 * device flow via `registerApp`: the user scans a QR code, an app is created, and
 * the returned credentials are written back into this plugin's config via
 * `runtime.config.patch` (no manual appId/appSecret entry needed). The host reloads
 * the gateway once login resolves, bringing the new account online.
 */
export function createFeishuAuth(): ChannelAuthAdapter {
  return {
    async login(ctx: AuthContext) {
      ctx.onStatus?.("starting", "正在发起飞书一键创建应用…");

      const result = await registerApp({
        onQRCodeReady(info) {
          ctx.onQrCode?.(info.url, info.url);
          ctx.onStatus?.("qr_ready", `请使用飞书扫码（${info.expireIn}s 内有效）`);
        },
        onStatusChange(info) {
          ctx.onStatus?.(info.status);
        },
      });

      // config.patch is a top-level shallow merge, so merge `accounts` ourselves
      // to preserve any other accounts and existing fields on `default`.
      const existing = (ctx.config.accounts as Record<string, unknown> | undefined) ?? {};
      const existingDefault = (existing.default as Record<string, unknown> | undefined) ?? {};
      const domain = result.user_info?.tenant_brand === "lark" ? "lark" : "feishu";

      await ctx.runtime.config.patch({
        accounts: {
          ...existing,
          default: {
            ...existingDefault,
            appId: result.client_id,
            appSecret: result.client_secret,
            domain,
          },
        },
      });

      // Authorize the registering user so they can immediately DM the bot.
      if (result.user_info?.open_id) {
        await ctx.runtime.identity.bind(result.user_info.open_id);
      }

      ctx.onStatus?.("success", "应用创建成功，凭据已写入");
    },

    async disconnect(ctx: AuthContext) {
      ctx.onStatus?.("disconnecting", "正在断开飞书连接…");

      // Clear stored credentials so the channel returns to an unconfigured state
      // and can be re-authorized via scan login. `config.patch` is a top-level
      // shallow merge, so replacing `accounts` with {} drops every account.
      // Identity authorizations (cola channel allow/revoke) are left intact.
      await ctx.runtime.config.patch({ accounts: {} });

      ctx.onStatus?.("disconnected", "已断开，凭据已清空");
    },
  };
}
