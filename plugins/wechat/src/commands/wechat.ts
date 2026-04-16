import type { PluginCommandContext, PluginCommandResult } from 'cola-plugin-sdk'
import { listAccountIds, resolveAccount } from '../auth/accounts.js'
import { isSessionPaused, getRemainingPauseMs } from '../api/session-guard.js'
import { getConfigManagerForAccount } from '../gateway/monitor.js'
import {
  fetchQRCode,
  pollQrLoginBackground,
  FIXED_BASE_URL,
  DEFAULT_ILINK_BOT_TYPE,
} from '../auth/qr-login.js'

export async function handleWechat(ctx: PluginCommandContext): Promise<PluginCommandResult> {
  const subcommand = ctx.args.trim().toLowerCase()

  if (subcommand === 'login') {
    return handleLogin(ctx)
  }

  if (subcommand === '' || subcommand === 'status') {
    return handleStatus(ctx)
  }

  return {
    reply: [
      '用法: /wechat [子命令]',
      '',
      '  /wechat        — 查看状态',
      '  /wechat login  — 扫码登录',
    ].join('\n'),
  }
}

function handleStatus(ctx: PluginCommandContext): PluginCommandResult {
  const accountIds = listAccountIds()

  if (accountIds.length === 0) {
    return { reply: 'WeChat: 未配置账号。发送 `/wechat login` 扫码登录。' }
  }

  const lines: string[] = ['**WeChat 状态**', '']

  for (const accountId of accountIds) {
    const account = resolveAccount(accountId, ctx.config)
    const hasConfigManager = !!getConfigManagerForAccount(accountId)
    const paused = isSessionPaused(accountId)

    const flags: string[] = []
    if (!account.configured) flags.push('未配置')
    if (!account.enabled) flags.push('已禁用')
    if (hasConfigManager) flags.push('监听中')
    else flags.push('未监听')
    if (paused) {
      const remainingMin = Math.ceil(getRemainingPauseMs(accountId) / 60_000)
      flags.push(`会话暂停 (${remainingMin}分钟)`)
    }

    const name = account.name || accountId
    lines.push(`- **${name}**: ${flags.join(' · ')}`)
  }

  return { reply: lines.join('\n') }
}

async function handleLogin(ctx: PluginCommandContext): Promise<PluginCommandResult> {
  const log = ctx.logger

  let qrResponse
  try {
    qrResponse = await fetchQRCode(FIXED_BASE_URL, DEFAULT_ILINK_BOT_TYPE)
  } catch (err) {
    log.error(`Failed to fetch QR code: ${String(err)}`)
    return { reply: `获取二维码失败: ${String(err)}` }
  }

  // Start background poll (fire-and-forget)
  if (ctx.runtime) {
    pollQrLoginBackground({
      qrcode: qrResponse.qrcode,
      runtime: ctx.runtime,
      logger: log,
    }).catch((err) => {
      log.error(`Background login poll error: ${String(err)}`)
    })
  } else {
    log.warn('No runtime available, login will not auto-bind identity')
  }

  const qrImage = qrResponse.qrcode_img_content
  const isDataUrl = qrImage.startsWith('data:')

  const lines: string[] = []
  if (isDataUrl) {
    lines.push(`![WeChat QR](${qrImage})`)
  } else {
    lines.push(`二维码链接: ${qrImage}`)
  }
  lines.push('')
  lines.push('请使用微信扫描二维码登录。扫码完成后发送 `/wechat` 查看状态。')

  return { reply: lines.join('\n') }
}
