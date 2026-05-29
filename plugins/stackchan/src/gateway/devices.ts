import type { WebSocket } from "ws";
import type { DeviceServerMessage } from "../types";

/** In-memory snapshot of a connected device. `lastStatus` is populated only when the device sends a status frame. */
export type Device = {
  socket: WebSocket;
  deviceId: string;
  name?: string;
  firmwareVersion?: string;
  lastSeen: number;
  lastStatus?: Record<string, unknown>;
};

/** Multi-device registry consumed by the gateway. All methods are safe to call concurrently from a single Node event loop — internal state lives in a Map + WeakMap pair. */
export type DeviceRegistry = {
  /** Add or replace a device. If a different socket is already registered for `deviceId`, that socket is closed with code 1000 before the new entry is recorded. */
  register(
    socket: WebSocket,
    info: { deviceId: string; name?: string; firmwareVersion?: string },
  ): Device;
  /** Remove a device entry, but only if the supplied socket matches the one currently registered. A `forget` from a displaced socket is a no-op. */
  forget(socket: WebSocket): void;
  /** Bump `lastSeen` for the device that owns this socket. No-op if the socket is unknown or has been replaced. */
  touch(socket: WebSocket): void;
  /** Look up a device by id. */
  find(deviceId: string): Device | undefined;
  /** Snapshot of all current devices. Safe to iterate while the registry mutates — the returned array is a copy. */
  list(): Device[];
  /** Persist a status payload sent by the device. **Does not** bump `lastSeen` — callers are responsible for invoking `touch` on every inbound frame. */
  recordStatus(socket: WebSocket, status: Record<string, unknown>): void;
  /** Heartbeat pumper. Closes any device whose `lastSeen` is strictly older than `now() - staleAfterMs` with code 1001, pings the rest, and invokes `onPing` per surviving device. Returns immediately if `staleAfterMs` is non-positive or NaN. Send errors are swallowed; eviction handles persistent failures on the next tick. */
  tick(opts: {
    pingPayload: DeviceServerMessage;
    staleAfterMs: number;
    onPing?: (device: Device) => void;
  }): void;
  /** Look up which deviceId owns this socket. */
  resolveDeviceId(socket: WebSocket): string | undefined;
};

/** Construct a registry. `opts.now` is dependency-injected for testability and should return a monotonic millisecond clock. Forward clock jumps will cause a wave of evictions on the next tick (devices reconnect). */
export function createDeviceRegistry(opts: { now: () => number }): DeviceRegistry {
  const devices = new Map<string, Device>();
  const socketToId = new WeakMap<WebSocket, string>();

  function register(
    socket: WebSocket,
    info: { deviceId: string; name?: string; firmwareVersion?: string },
  ): Device {
    const existing = devices.get(info.deviceId);
    if (existing && existing.socket !== socket) {
      existing.socket.close(1000, "Replaced by a new StackChan connection");
    }
    socketToId.set(socket, info.deviceId);
    const device: Device = {
      socket,
      deviceId: info.deviceId,
      name: info.name,
      firmwareVersion: info.firmwareVersion,
      lastSeen: opts.now(),
    };
    devices.set(info.deviceId, device);
    return device;
  }

  function forget(socket: WebSocket): void {
    const id = socketToId.get(socket);
    if (!id) return;
    const device = devices.get(id);
    if (device?.socket === socket) devices.delete(id);
    socketToId.delete(socket);
  }

  function touch(socket: WebSocket): void {
    const id = socketToId.get(socket);
    if (!id) return;
    const device = devices.get(id);
    if (device?.socket === socket) device.lastSeen = opts.now();
  }

  function find(deviceId: string): Device | undefined {
    return devices.get(deviceId);
  }

  function list(): Device[] {
    return [...devices.values()];
  }

  function recordStatus(socket: WebSocket, status: Record<string, unknown>): void {
    const id = socketToId.get(socket);
    if (!id) return;
    const device = devices.get(id);
    if (device?.socket === socket) device.lastStatus = status;
  }

  function resolveDeviceId(socket: WebSocket): string | undefined {
    return socketToId.get(socket);
  }

  function tick(args: {
    pingPayload: DeviceServerMessage;
    staleAfterMs: number;
    onPing?: (device: Device) => void;
  }): void {
    if (!Number.isFinite(args.staleAfterMs) || args.staleAfterMs <= 0) return;
    const cutoff = opts.now() - args.staleAfterMs;
    for (const device of Array.from(devices.values())) {
      if (device.lastSeen < cutoff) {
        device.socket.close(1001, "StackChan heartbeat timeout");
        devices.delete(device.deviceId);
        socketToId.delete(device.socket);
        continue;
      }
      try {
        device.socket.send(JSON.stringify(args.pingPayload));
        args.onPing?.(device);
      } catch {
        // socket may be in the middle of closing; ignore — eviction will handle it next tick.
      }
    }
  }

  return {
    register,
    forget,
    touch,
    find,
    list,
    recordStatus,
    tick,
    resolveDeviceId,
  };
}
