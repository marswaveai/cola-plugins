import path from 'node:path'

import type { PluginLogger } from 'cola-plugin-sdk'
import type { WeixinApiOptions } from '../api/client.js'
import { getMimeFromFilename } from '../media/mime.js'
import { sendFileMessageWeixin, sendImageMessageWeixin, sendVideoMessageWeixin } from './send.js'
import { uploadFileAttachmentToWeixin, uploadFileToWeixin, uploadVideoToWeixin } from '../cdn/upload.js'

export async function sendWeixinMediaFile(params: {
  filePath: string
  to: string
  text: string
  opts: WeixinApiOptions & { contextToken?: string }
  cdnBaseUrl: string
  log: PluginLogger
}): Promise<{ messageId: string }> {
  const { filePath, to, text, opts, cdnBaseUrl, log } = params
  const mime = getMimeFromFilename(filePath)
  const uploadOpts: WeixinApiOptions = { baseUrl: opts.baseUrl, token: opts.token }

  if (mime.startsWith('video/')) {
    const uploaded = await uploadVideoToWeixin({ filePath, toUserId: to, opts: uploadOpts, cdnBaseUrl, log })
    return sendVideoMessageWeixin({ to, text, uploaded, opts, log })
  }

  if (mime.startsWith('image/')) {
    const uploaded = await uploadFileToWeixin({ filePath, toUserId: to, opts: uploadOpts, cdnBaseUrl, log })
    return sendImageMessageWeixin({ to, text, uploaded, opts, log })
  }

  const fileName = path.basename(filePath)
  const uploaded = await uploadFileAttachmentToWeixin({ filePath, fileName, toUserId: to, opts: uploadOpts, cdnBaseUrl, log })
  return sendFileMessageWeixin({ to, text, fileName, uploaded, opts, log })
}
