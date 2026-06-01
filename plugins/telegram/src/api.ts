import type { TelegramResponse, TelegramUpdate, TelegramUser } from "./types.js";

export type TelegramApiClientOptions = {
  botToken: string;
  apiBaseUrl: string;
};

export type SendMessageOptions = {
  chatId: string;
  text: string;
  messageThreadId?: number;
  signal?: AbortSignal;
};

export type SendChatActionOptions = {
  chatId: string;
  action: "typing";
  messageThreadId?: number;
  signal?: AbortSignal;
};

export class TelegramApiError extends Error {
  readonly method: string;
  readonly code?: number;

  constructor(method: string, message: string, code?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.method = method;
    this.code = code;
  }
}

export class TelegramApiClient {
  private readonly botToken: string;
  private readonly apiBaseUrl: string;

  constructor(options: TelegramApiClientOptions) {
    this.botToken = options.botToken;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
  }

  async getMe(signal?: AbortSignal): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe", {}, signal);
  }

  async deleteWebhook(dropPendingUpdates: boolean, signal?: AbortSignal): Promise<boolean> {
    return this.request<boolean>(
      "deleteWebhook",
      { drop_pending_updates: dropPendingUpdates },
      signal,
    );
  }

  async getUpdates(
    offset: number | undefined,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    return this.request<TelegramUpdate[]>(
      "getUpdates",
      {
        ...(offset !== undefined ? { offset } : {}),
        timeout: timeoutSeconds,
        allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
      },
      signal,
    );
  }

  async sendMessage(options: SendMessageOptions): Promise<void> {
    await this.request(
      "sendMessage",
      {
        chat_id: coerceTelegramChatId(options.chatId),
        text: options.text,
        disable_web_page_preview: false,
        ...(options.messageThreadId !== undefined
          ? { message_thread_id: options.messageThreadId }
          : {}),
      },
      options.signal,
    );
  }

  async sendChatAction(options: SendChatActionOptions): Promise<void> {
    await this.request(
      "sendChatAction",
      {
        chat_id: coerceTelegramChatId(options.chatId),
        action: options.action,
        ...(options.messageThreadId !== undefined
          ? { message_thread_id: options.messageThreadId }
          : {}),
      },
      options.signal,
    );
  }

  private async request<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    const parsed = parseTelegramResponse<T>(method, text);

    if (!response.ok) {
      const message = parsed.ok
        ? `Telegram ${method} failed with HTTP ${response.status}`
        : (parsed.description ?? `Telegram ${method} failed with HTTP ${response.status}`);
      throw new TelegramApiError(method, message, parsed.ok ? undefined : parsed.error_code);
    }

    if (!parsed.ok) {
      throw new TelegramApiError(
        method,
        parsed.description ?? `Telegram ${method} failed`,
        parsed.error_code,
      );
    }

    return parsed.result;
  }
}

function parseTelegramResponse<T>(method: string, text: string): TelegramResponse<T> {
  try {
    return JSON.parse(text) as TelegramResponse<T>;
  } catch {
    throw new TelegramApiError(method, `Telegram ${method} returned invalid JSON`);
  }
}

function coerceTelegramChatId(chatId: string): string | number {
  return /^-?\d+$/.test(chatId) ? Number(chatId) : chatId;
}
