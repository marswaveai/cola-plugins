import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import type { PluginLogger } from '@marswave/cola-plugin-sdk'
import type { MessageItem } from '../api/types.js'
import { MessageItemType } from '../api/types.js'
import { getMimeFromFilename } from './mime.js'
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from '../cdn/download.js'
import { silkToWav } from './silk-transcode.js'
import { tempFileName } from '../util/random.js'

const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024

export type MediaDownloadResult = {
  filePath?: string
  mediaType?: string
}

async function saveToTemp(buf: Buffer, ext: string): Promise<string> {
  const dir = path.join(os.tmpdir(), 'cola-wechat-media')
  await fs.mkdir(dir, { recursive: true })
  const name = tempFileName('wechat', ext)
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, buf)
  return filePath
}

export async function downloadMediaFromItem(
  item: MessageItem,
  deps: {
    cdnBaseUrl: string
    log: PluginLogger
  },
): Promise<MediaDownloadResult> {
  const { cdnBaseUrl, log } = deps
  const result: MediaDownloadResult = {}

  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item
    if (!img?.media?.encrypt_query_param && !img?.media?.full_url) return result
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, 'hex').toString('base64')
      : img.media!.aes_key
    try {
      const buf = aesKeyBase64
        ? await downloadAndDecryptBuffer(
            img.media!.encrypt_query_param ?? '',
            aesKeyBase64,
            cdnBaseUrl,
            'image',
            log,
            img.media!.full_url,
          )
        : await downloadPlainCdnBuffer(
            img.media!.encrypt_query_param ?? '',
            cdnBaseUrl,
            'image-plain',
            log,
            img.media!.full_url,
          )
      if (buf.length > WEIXIN_MEDIA_MAX_BYTES) {
        log.warn(`image too large: ${buf.length} bytes, skipping`)
        return result
      }
      result.filePath = await saveToTemp(buf, '.png')
      result.mediaType = 'image/png'
    } catch (err) {
      log.error(`image download/decrypt failed: ${String(err)}`)
    }
  } else if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item
    if ((!voice?.media?.encrypt_query_param && !voice?.media?.full_url) || !voice?.media?.aes_key)
      return result
    try {
      const silkBuf = await downloadAndDecryptBuffer(
        voice.media.encrypt_query_param ?? '',
        voice.media.aes_key,
        cdnBaseUrl,
        'voice',
        log,
        voice.media.full_url,
      )
      const wavBuf = await silkToWav(silkBuf, log)
      if (wavBuf) {
        result.filePath = await saveToTemp(wavBuf, '.wav')
        result.mediaType = 'audio/wav'
      } else {
        result.filePath = await saveToTemp(silkBuf, '.silk')
        result.mediaType = 'audio/silk'
      }
    } catch (err) {
      log.error(`voice download/transcode failed: ${String(err)}`)
    }
  } else if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item
    if ((!fileItem?.media?.encrypt_query_param && !fileItem?.media?.full_url) || !fileItem?.media?.aes_key)
      return result
    try {
      const buf = await downloadAndDecryptBuffer(
        fileItem.media.encrypt_query_param ?? '',
        fileItem.media.aes_key,
        cdnBaseUrl,
        'file',
        log,
        fileItem.media.full_url,
      )
      const mime = getMimeFromFilename(fileItem.file_name ?? 'file.bin')
      const ext = path.extname(fileItem.file_name ?? '.bin') || '.bin'
      result.filePath = await saveToTemp(buf, ext)
      result.mediaType = mime
    } catch (err) {
      log.error(`file download failed: ${String(err)}`)
    }
  } else if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item
    if ((!videoItem?.media?.encrypt_query_param && !videoItem?.media?.full_url) || !videoItem?.media?.aes_key)
      return result
    try {
      const buf = await downloadAndDecryptBuffer(
        videoItem.media.encrypt_query_param ?? '',
        videoItem.media.aes_key,
        cdnBaseUrl,
        'video',
        log,
        videoItem.media.full_url,
      )
      result.filePath = await saveToTemp(buf, '.mp4')
      result.mediaType = 'video/mp4'
    } catch (err) {
      log.error(`video download failed: ${String(err)}`)
    }
  }

  return result
}
