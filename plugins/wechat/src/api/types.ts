/**
 * Weixin protocol types (mirrors proto: GetUpdatesReq/Resp, WeixinMessage, SendMessageReq).
 * API uses JSON over HTTP; bytes fields are base64 strings in JSON.
 */

/** Common request metadata attached to every CGI request. */
export type BaseInfo = {
  channel_version?: string
}

/** proto: UploadMediaType */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const

export type GetUploadUrlReq = {
  filekey?: string
  media_type?: number
  to_user_id?: string
  rawsize?: number
  rawfilemd5?: string
  filesize?: number
  thumb_rawsize?: number
  thumb_rawfilemd5?: string
  thumb_filesize?: number
  no_need_thumb?: boolean
  aeskey?: string
}

export type GetUploadUrlResp = {
  upload_param?: string
  thumb_upload_param?: string
  upload_full_url?: string
}

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const

export type TextItem = {
  text?: string
}

/** CDN media reference; aes_key is base64-encoded bytes in JSON. */
export type CDNMedia = {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
  full_url?: string
}

export type ImageItem = {
  media?: CDNMedia
  thumb_media?: CDNMedia
  /** Raw AES-128 key as hex string (16 bytes); preferred over media.aes_key for inbound decryption. */
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
}

export type VoiceItem = {
  media?: CDNMedia
  encode_type?: number
  bits_per_sample?: number
  sample_rate?: number
  playtime?: number
  text?: string
}

export type FileItem = {
  media?: CDNMedia
  file_name?: string
  md5?: string
  len?: string
}

export type VideoItem = {
  media?: CDNMedia
  video_size?: number
  play_length?: number
  video_md5?: string
  thumb_media?: CDNMedia
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
}

export type RefMessage = {
  message_item?: MessageItem
  title?: string
}

export type MessageItem = {
  type?: number
  create_time_ms?: number
  update_time_ms?: number
  is_completed?: boolean
  msg_id?: string
  ref_msg?: RefMessage
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
}

export type WeixinMessage = {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  create_time_ms?: number
  update_time_ms?: number
  delete_time_ms?: number
  session_id?: string
  group_id?: string
  message_type?: number
  message_state?: number
  item_list?: MessageItem[]
  context_token?: string
}

export type GetUpdatesReq = {
  get_updates_buf?: string
}

export type GetUpdatesResp = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export type SendMessageReq = {
  msg?: WeixinMessage
}

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const

export type SendTypingReq = {
  ilink_user_id?: string
  typing_ticket?: string
  status?: number
}

export type GetConfigResp = {
  ret?: number
  errmsg?: string
  typing_ticket?: string
}
