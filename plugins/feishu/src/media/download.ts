import fs from 'fs'
import path from 'path'
import os from 'os'
import type * as lark from '@larksuiteoapi/node-sdk'
import type { PluginLogger } from 'cola-plugin-sdk'

/**
 * Download a message resource (image/file) from Feishu and save to a temp file.
 */
export async function downloadMessageResource(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  type: 'image' | 'file',
  fileName: string,
  logger: PluginLogger,
): Promise<string | undefined> {
  try {
    const resp = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    })

    if (!resp) {
      logger.warn(`Empty response downloading ${type} ${fileKey} from message ${messageId}`)
      return undefined
    }

    const tmpDir = path.join(os.tmpdir(), 'cola-feishu')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpPath = path.join(tmpDir, `${Date.now()}-${fileName}`)

    // The SDK returns a readable stream or buffer
    const data = resp as unknown
    if (Buffer.isBuffer(data)) {
      fs.writeFileSync(tmpPath, data)
    } else if (data && typeof (data as NodeJS.ReadableStream).pipe === 'function') {
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(tmpPath)
        ;(data as NodeJS.ReadableStream).pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
      })
    } else {
      logger.warn(`Unexpected response type for ${type} download`)
      return undefined
    }

    return tmpPath
  } catch (err) {
    logger.warn(`Failed to download ${type} ${fileKey}: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}
