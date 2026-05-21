import { defineChannel } from 'cola-plugin-sdk'
import type { OutboundContext, ChannelStatusResult } from 'cola-plugin-sdk'
import { readConfig } from './config'
import { gatewayState, send, startGateway, stopGateway, type StackChanState } from './gateway/server'
import { createStackchanCommands } from './commands/stackchan'

export default defineChannel<StackChanState>({
  id: 'stackchan',
  meta: {
    label: 'StackChan',
    description: 'M5Stack StackChan voice channel over WebSocket',
    markdownCapable: false
  },
  capabilities: {
    receive: { text: true, voice: true },
    send: { text: true, voice: true, typing: true },
    limits: { maxTextLength: 4000 }
  },
  config: {
    schema: {
      fields: [
        { key: 'host', label: 'Host', type: 'text', defaultValue: '0.0.0.0' },
        { key: 'port', label: 'Port', type: 'number', defaultValue: 19540 },
        { key: 'path', label: 'Path', type: 'text', defaultValue: '/stackchan' },
        { key: 'requireToken', label: 'Require token', type: 'boolean', defaultValue: false },
        { key: 'token', label: 'Shared token', type: 'password', secret: true },
        {
          key: 'accessToken',
          label: 'Marswave access token',
          type: 'password',
          secret: true,
          description: 'Used for the listenhub /tts endpoint.'
        },
        { key: 'speakerId', label: 'TTS speaker id', type: 'text' },
        {
          key: 'language',
          label: 'ASR / TTS language',
          type: 'select',
          defaultValue: 'auto',
          options: [
            { label: 'Auto', value: 'auto' },
            { label: '中文', value: 'zh' },
            { label: 'English', value: 'en' },
            { label: '日本語', value: 'ja' },
            { label: '한국어', value: 'ko' }
          ]
        }
      ]
    }
  },
  commands: createStackchanCommands(
    () => gatewayState.registry,
    () => gatewayState.statusMessage
  ),
  gateway: {
    async start(ctx) {
      await startGateway(ctx, readConfig(ctx.config))
    },
    async stop(ctx) {
      stopGateway(ctx.state)
    },
    getStatus(ctx): ChannelStatusResult {
      const list = gatewayState.registry?.list() ?? []
      return {
        connected: list.length > 0,
        configured: gatewayState.server !== null,
        message: `${gatewayState.statusMessage}; devices=${list.length}`
      }
    }
  },
  outbound: {
    textChunkLimit: 1000,
    async sendText(ctx: OutboundContext) {
      const deviceId = ctx.deliveryContext.to
      const device = gatewayState.registry?.find(deviceId)
      if (!device) {
        ctx.logger.warn(`no device for outbound text: ${deviceId}`)
        return
      }
      send(device.socket, {
        type: 'reply.sentence',
        promptId: ctx.promptId,
        text: ctx.text,
        ttsBytes: 0
      })
      send(device.socket, { type: 'reply.end', promptId: ctx.promptId })
    }
  }
})
