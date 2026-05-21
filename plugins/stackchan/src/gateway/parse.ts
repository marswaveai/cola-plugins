import type { DeviceClientMessage } from '../types'

export function parseDeviceMessage(raw: string | Buffer): DeviceClientMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null

  switch (parsed.type) {
    case 'hello': {
      const deviceId = readString(parsed.deviceId)
      if (!deviceId) return null
      return {
        type: 'hello',
        deviceId,
        ...(typeof parsed.name === 'string' && { name: parsed.name }),
        ...(typeof parsed.firmwareVersion === 'string' && {
          firmwareVersion: parsed.firmwareVersion
        }),
        ...(typeof parsed.token === 'string' && { token: parsed.token })
      }
    }
    case 'audio.start': {
      const promptId = readString(parsed.promptId)
      if (!promptId) return null
      return {
        type: 'audio.start',
        promptId,
        ...(typeof parsed.language === 'string' && { language: parsed.language }),
        ...(typeof parsed.sampleRate === 'number' && { sampleRate: parsed.sampleRate })
      }
    }
    case 'audio.end': {
      const promptId = readString(parsed.promptId)
      if (!promptId) return null
      return {
        type: 'audio.end',
        promptId,
        ...(typeof parsed.samplesTotal === 'number' && { samplesTotal: parsed.samplesTotal })
      }
    }
    case 'pong': {
      return {
        type: 'pong',
        ...(typeof parsed.timestamp === 'number' && { timestamp: parsed.timestamp })
      }
    }
    case 'status': {
      const rest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) }
      delete rest.type
      const promptId = rest.promptId
      delete rest.promptId
      const detailKeys = Object.keys(rest)
      return {
        type: 'status',
        ...(typeof promptId === 'string' && promptId.trim() && { promptId: promptId.trim() }),
        ...(detailKeys.length > 0 && { details: rest })
      }
    }
    default:
      return null
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
