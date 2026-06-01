# StackChan Channel Plugin

Connect Cola to M5Stack StackChan devices through a local WebSocket gateway.

## Features

- Receives text prompts and voice/audio turns from connected StackChan devices.
- Sends text and voice replies back to devices.
- Tracks connected devices and exposes gateway status through plugin commands.
- Uses Cola-host-provided TTS when available, with a plugin-configured TTS fallback.

## Requirements

- A StackChan device or compatible firmware that can connect to a WebSocket server.
- Network access from the device to the Mac running Cola.
- A reachable host, port, and path for the plugin gateway.

## Setup

1. Install the StackChan plugin from the Cola plugin store.
2. Open the plugin settings in Cola.
3. Keep the default gateway values unless your network requires a different host, port, or path.
4. Configure the StackChan device to connect to the gateway endpoint.
5. Use `/stackchan status` in Cola to confirm that the device is connected.

The default device endpoint is:

```text
ws://<cola-host>:19540/stackchan
```

If `requireToken` is enabled, configure the same `token` on the device. The
device must send that token in its initial `hello` message.

## Configuration

| Field          | Required | Default      | Description                                                  |
| -------------- | -------- | ------------ | ------------------------------------------------------------ |
| `host`         | No       | `0.0.0.0`    | WebSocket bind host.                                         |
| `port`         | No       | `19540`      | WebSocket bind port.                                         |
| `path`         | No       | `/stackchan` | WebSocket path.                                              |
| `requireToken` | No       | `false`      | Require devices to send the shared token in the hello frame. |
| `token`        | No       |              | Shared device token, stored as a secret value.               |
| `accessToken`  | No       |              | Legacy Marswave access token for fallback TTS.               |
| `speakerId`    | No       |              | Optional TTS speaker ID.                                     |
| `language`     | No       | `auto`       | ASR/TTS language: `auto`, `zh`, `en`, `ja`, or `ko`.         |

## Commands

```text
/stackchan status
/stackchan bind <deviceId>
/stackchan unbind <deviceId>
```

Use `bind` when a device identity should be associated with the current Cola
identity. Use `unbind` to remove that association.
