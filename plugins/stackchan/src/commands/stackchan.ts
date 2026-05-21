import type { PluginCommandDefinition } from 'cola-plugin-sdk'
import type { DeviceRegistry } from '../gateway/devices'

export function createStackchanCommands(
  getRegistry: () => DeviceRegistry | null,
  getStatusMessage: () => string
): PluginCommandDefinition[] {
  return [
    {
      name: 'stackchan',
      description: 'Manage StackChan device bindings.',
      args: [
        { name: 'action', description: 'bind | unbind | status', required: true },
        { name: 'deviceId', description: 'device id (for bind/unbind)', required: false }
      ],
      async execute(ctx) {
        const [action, deviceId] = ctx.args.split(/\s+/).filter(Boolean)
        if (!ctx.runtime) return { reply: 'StackChan runtime is unavailable.' }

        if (action === 'bind' && deviceId) {
          await ctx.runtime.identity.bind(deviceId)
          return { reply: `Bound StackChan device ${deviceId}.` }
        }
        if (action === 'unbind' && deviceId) {
          await ctx.runtime.identity.unbind(deviceId)
          return { reply: `Unbound StackChan device ${deviceId}.` }
        }
        if (action === 'status' || !action) {
          const reg = getRegistry()
          const list = reg?.list() ?? []
          const connected = list
            .map((d) => `${d.deviceId}${d.name ? ` (${d.name})` : ''}`)
            .join(', ')
          return {
            reply: connected
              ? `StackChan gateway: ${getStatusMessage()}. Connected: ${connected}.`
              : `StackChan gateway: ${getStatusMessage()}. No devices connected.`
          }
        }
        return { reply: 'Usage: /stackchan bind <id> | unbind <id> | status' }
      }
    }
  ]
}
