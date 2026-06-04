export type TelegramResponse<T> =
  | {
      ok: true;
      result: T;
    }
  | {
      ok: false;
      error_code?: number;
      description?: string;
      parameters?: {
        retry_after?: number;
        migrate_to_chat_id?: number;
      };
    };

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  user?: TelegramUser;
};

export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  photo?: unknown[];
  document?: {
    file_name?: string;
    mime_type?: string;
  };
  audio?: {
    file_name?: string;
    title?: string;
  };
  voice?: unknown;
  video?: {
    file_name?: string;
  };
  sticker?: {
    emoji?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};
