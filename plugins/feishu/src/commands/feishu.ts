import type { PluginCommandDefinition } from 'cola-plugin-sdk'
import type { MonitorHandle } from '../gateway/monitor.js'
import { redactSecret } from '../util/redact.js'

export function createFeishuCommands(
  getMonitors: () => Map<string, MonitorHandle>,
  getConfig: () => Readonly<Record<string, unknown>>,
): PluginCommandDefinition[] {
  return [
    {
      name: 'feishu',
      aliases: ['fs', 'lark'],
      description: 'Feishu plugin status and account info',
      args: [{ name: 'subcommand', description: '"status" or "accounts"', required: false }],
      async execute(ctx) {
        const sub = ctx.args.trim() || 'status'
        const monitors = getMonitors()

        if (sub === 'status') {
          if (monitors.size === 0) {
            return { reply: 'No Feishu accounts active.' }
          }
          const lines = ['**Feishu Status**', '']
          for (const [id, handle] of monitors) {
            lines.push(`- **${id}**: connected (client ready)`)
          }
          return { reply: lines.join('\n') }
        }

        if (sub === 'accounts') {
          const config = getConfig()
          const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>
          if (Object.keys(accounts).length === 0) {
            return { reply: 'No Feishu accounts configured.' }
          }
          const lines = ['**Feishu Accounts**', '']
          for (const [id, acct] of Object.entries(accounts)) {
            const appId = typeof acct.appId === 'string' ? redactSecret(acct.appId) : '(missing)'
            const domain = (acct.domain as string) ?? 'feishu'
            const mode = (acct.connectionMode as string) ?? 'websocket'
            const active = monitors.has(id) ? 'active' : 'inactive'
            lines.push(`- **${id}**: appId=${appId}, domain=${domain}, mode=${mode}, ${active}`)
          }
          return { reply: lines.join('\n') }
        }

        return { reply: `Unknown subcommand: ${sub}. Use "status" or "accounts".` }
      },
    },
  ]
}
