import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginLogger } from 'cola-plugin-sdk'
import type { WeixinApiOptions } from '../api/client.js'
import { getUploadUrl } from '../api/client.js'
import { UploadMediaType } from '../api/types.js'
import { getExtensionFromContentTypeOrUrl } from '../media/mime.js'
import { tempFileName } from '../util/random.js'
import { aesEcbPaddedSize } from './aes-ecb.js'
import { uploadBufferToCdn } from './cdn-upload.js'

export type UploadedFileInfo = {
  filekey: string
  downloadEncryptedQueryParam: string
  aeskey: string
  fileSize: number
  fileSizeCiphertext: number
}

export async function downloadRemoteImageToTemp(url: string, destDir: string, log: PluginLogger): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`remote media download failed: ${res.status} ${res.statusText} url=${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.mkdir(destDir, { recursive: true })
  const ext = getExtensionFromContentTypeOrUrl(res.headers.get('content-type'), url)
  const name = tempFileName('weixin-remote', ext)
  const filePath = path.join(destDir, name)
  await fs.writeFile(filePath, buf)
  log.info(`downloadRemoteImageToTemp: saved ${buf.length} bytes to ${filePath}`)
  return filePath
}

async function uploadMediaToCdn(params: {
  filePath: string
  toUserId: string
  opts: WeixinApiOptions
  cdnBaseUrl: string
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType]
  label: string
  log: PluginLogger
}): Promise<UploadedFileInfo> {
  const { filePath, toUserId, opts, cdnBaseUrl, mediaType, label, log } = params

  const plaintext = await fs.readFile(filePath)
  const rawsize = plaintext.length
  const rawfilemd5 = crypto.createHash('md5').update(plaintext).digest('hex')
  const filesize = aesEcbPaddedSize(rawsize)
  const filekey = crypto.randomBytes(16).toString('hex')
  const aeskey = crypto.randomBytes(16)

  const uploadUrlResp = await getUploadUrl({
    ...opts,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex'),
  })

  const uploadFullUrl = uploadUrlResp.upload_full_url?.trim()
  const uploadParam = uploadUrlResp.upload_param
  if (!uploadFullUrl && !uploadParam) {
    throw new Error(`${label}: getUploadUrl returned no upload URL`)
  }

  const { downloadParam: downloadEncryptedQueryParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl: uploadFullUrl || undefined,
    uploadParam: uploadParam ?? undefined,
    filekey,
    cdnBaseUrl,
    aeskey,
    label: `${label}[filekey=${filekey}]`,
    log,
  })

  return {
    filekey,
    downloadEncryptedQueryParam,
    aeskey: aeskey.toString('hex'),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  }
}

export async function uploadFileToWeixin(params: {
  filePath: string
  toUserId: string
  opts: WeixinApiOptions
  cdnBaseUrl: string
  log: PluginLogger
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({ ...params, mediaType: UploadMediaType.IMAGE, label: 'uploadImage' })
}

export async function uploadVideoToWeixin(params: {
  filePath: string
  toUserId: string
  opts: WeixinApiOptions
  cdnBaseUrl: string
  log: PluginLogger
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({ ...params, mediaType: UploadMediaType.VIDEO, label: 'uploadVideo' })
}

export async function uploadFileAttachmentToWeixin(params: {
  filePath: string
  fileName: string
  toUserId: string
  opts: WeixinApiOptions
  cdnBaseUrl: string
  log: PluginLogger
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({ ...params, mediaType: UploadMediaType.FILE, label: 'uploadFile' })
}
