import type { ChannelSetupWizard } from 'cola-plugin-sdk'
import type { FeishuAccountConfig, FeishuDomain } from '../api/types.js'

type FeishuTokenResponse = {
  code: number
  msg: string
  tenant_access_token?: string
  expire?: number
}

function resolveDomainHost(domain: FeishuDomain | undefined): string {
  return domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
}

async function verifyFeishuCredentials(params: {
  appId: string
  appSecret: string
  domain: FeishuDomain
}): Promise<void> {
  const host = resolveDomainHost(params.domain)
  const url = `${host}/open-apis/auth/v3/tenant_access_token/internal`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: params.appId, app_secret: params.appSecret }),
    })
  } catch (err) {
    throw new Error(`Could not reach Feishu (${host}): ${(err as Error).message}`)
  }

  if (!res.ok) {
    throw new Error(`Feishu API returned HTTP ${res.status} ${res.statusText}`)
  }

  let body: FeishuTokenResponse
  try {
    body = (await res.json()) as FeishuTokenResponse
  } catch {
    throw new Error('Feishu API returned a non-JSON response')
  }

  if (body.code !== 0) {
    throw new Error(`Feishu rejected the credentials: ${body.msg || `code ${body.code}`}`)
  }
}

export const feishuSetupWizard: ChannelSetupWizard = {
  getStatus: ({ existingConfig }) => {
    const accounts = (existingConfig as { accounts?: Record<string, FeishuAccountConfig> }).accounts ?? {}
    const main = accounts.main ?? ({} as Partial<FeishuAccountConfig>)
    const hasCreds = !!main.appId && !!main.appSecret
    return {
      configured: hasCreds,
      hint: hasCreds ? 'configured' : 'needs App ID + App Secret',
    }
  },

  credentials: [
    {
      key: 'appId',
      label: 'Feishu App ID',
      helpLines: [
        'From the Feishu Open Platform: https://open.feishu.cn/app',
        'Create (or open) your Enterprise self-built app; the ID looks like `cli_xxxxxxxxxxxxxxxx`.',
      ],
      preferredEnvVar: 'FEISHU_APP_ID',
      validate: (v) => (v.startsWith('cli_') ? null : 'Expected ID to start with "cli_"'),
    },
    {
      key: 'appSecret',
      label: 'Feishu App Secret',
      helpLines: ['Found on the same page, right below the App ID.'],
      preferredEnvVar: 'FEISHU_APP_SECRET',
      secret: true,
    },
  ],

  textInputs: [
    {
      key: 'domain',
      label: 'API domain',
      helpLines: [
        'Use "lark" for the international (lark.com) tenancy; "feishu" for the default Chinese one.',
      ],
      default: 'feishu',
      choices: ['feishu', 'lark'],
    },
    {
      key: 'connectionMode',
      label: 'Connection mode',
      helpLines: [
        'WebSocket needs no public URL — the SDK connects outbound. Recommended.',
        'Webhook runs an HTTP server locally; you must expose it publicly via tunneling.',
      ],
      default: 'websocket',
      choices: ['websocket', 'webhook'],
    },
  ],

  finalize: async ({ credentialValues, textInputValues }) => {
    const appId = credentialValues.appId
    const appSecret = credentialValues.appSecret
    const domain = (textInputValues.domain ?? 'feishu') as FeishuDomain
    const connectionMode = (textInputValues.connectionMode ?? 'websocket') as 'websocket' | 'webhook'

    await verifyFeishuCredentials({ appId, appSecret, domain })

    return {
      config: {
        accounts: {
          main: {
            appId,
            appSecret,
            domain,
            connectionMode,
          },
        },
      },
      completionNote:
        'Feishu configured. Gateway will start automatically. Send a message to your bot to test.',
    }
  },
}
