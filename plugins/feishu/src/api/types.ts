import * as lark from '@larksuiteoapi/node-sdk'

export type FeishuDomain = 'feishu' | 'lark' | (string & {})

export type FeishuAccountConfig = {
  appId: string
  appSecret: string
  domain?: FeishuDomain
  connectionMode?: 'websocket' | 'webhook'
  encryptKey?: string
  verificationToken?: string
  webhookPort?: number
  webhookPath?: string
  enabled?: boolean
}

export type FeishuPluginConfig = {
  pluginDir?: string
  accounts?: Record<string, FeishuAccountConfig>
}

export type ResolvedAccount = {
  id: string
  config: FeishuAccountConfig
  client: lark.Client
}

export type AccountHandle = {
  id: string
  client: lark.Client
  cleanup: () => void
}

// Feishu message event types
export type FeishuMessageEvent = {
  message: {
    message_id: string
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    mentions?: FeishuMention[]
  }
  sender: {
    sender_id: {
      open_id: string
      user_id?: string
      union_id?: string
    }
    sender_type: string
  }
}

export type FeishuMention = {
  key: string
  id: {
    open_id?: string
    user_id?: string
    union_id?: string
  }
  name: string
  tenant_key?: string
}

// Rich text content types
export type FeishuPostContent = {
  title?: string
  content: FeishuPostElement[][]
}

export type FeishuPostElement =
  | { tag: 'text'; text: string }
  | { tag: 'a'; text: string; href: string }
  | { tag: 'at'; user_id: string; user_name?: string }
  | { tag: 'img'; image_key: string }
  | { tag: 'md'; text: string }
