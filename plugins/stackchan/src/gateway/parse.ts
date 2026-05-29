import type { DeviceClientMessage } from "../types";

function stripDangerousKeys(obj: Record<string, unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete obj["__proto__"];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete obj["constructor"];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete obj["prototype"];
}

/**
 * Parse a WebSocket frame payload into a typed DeviceClientMessage.
 * Returns null for any malformed input (bad JSON, missing required field,
 * unknown type, non-object payload). Never throws.
 *
 * Behavior contract:
 * - Required string fields are trimmed; an all-whitespace value is rejected.
 * - Optional fields whose runtime type is wrong are silently dropped.
 * - The `status` variant collects any extra (non-`type`, non-`promptId`)
 *   keys under `details`, after stripping prototype-pollution keys.
 */
export function parseDeviceMessage(raw: string | Buffer): DeviceClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;

  switch (parsed.type) {
    case "hello": {
      const deviceId = readString(parsed.deviceId);
      if (!deviceId) return null;
      return {
        type: "hello",
        deviceId,
        ...(typeof parsed.name === "string" && { name: parsed.name }),
        ...(typeof parsed.firmwareVersion === "string" && {
          firmwareVersion: parsed.firmwareVersion,
        }),
        ...(typeof parsed.token === "string" && { token: parsed.token }),
      };
    }
    case "audio.start": {
      const promptId = readString(parsed.promptId);
      if (!promptId) return null;
      return {
        type: "audio.start",
        promptId,
        ...(typeof parsed.language === "string" && { language: parsed.language }),
        ...(Number.isFinite(parsed.sampleRate) && { sampleRate: parsed.sampleRate as number }),
      };
    }
    case "audio.end": {
      const promptId = readString(parsed.promptId);
      if (!promptId) return null;
      return {
        type: "audio.end",
        promptId,
        ...(Number.isFinite(parsed.samplesTotal) && {
          samplesTotal: parsed.samplesTotal as number,
        }),
      };
    }
    case "pong": {
      return {
        type: "pong",
        ...(Number.isFinite(parsed.timestamp) && { timestamp: parsed.timestamp as number }),
      };
    }
    case "status": {
      const rest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
      delete rest.type;
      const promptId = rest.promptId;
      // Only remove promptId from rest when it will be hoisted to the top level;
      // if it's not a valid string, leave it in rest so it appears in details.
      if (typeof promptId === "string" && promptId.trim()) {
        delete rest.promptId;
      }
      stripDangerousKeys(rest);
      const detailKeys = Object.keys(rest);
      return {
        type: "status",
        ...(typeof promptId === "string" && promptId.trim() && { promptId: promptId.trim() }),
        ...(detailKeys.length > 0 && { details: rest }),
      };
    }
    case "prompt": {
      const text = readString(parsed.text);
      if (!text) return null;
      return {
        type: "prompt",
        text,
        ...(typeof parsed.promptId === "string" && { promptId: parsed.promptId }),
      };
    }
    default:
      return null;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
