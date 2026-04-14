import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginsDir = path.resolve(__dirname, '..', 'plugins')

type RegistryEntry = {
  id: string
  label: string
  description?: string
  version: string
  minSdkVersion?: string
  downloadUrl: string
}

const entries: RegistryEntry[] = []

for (const name of fs.readdirSync(pluginsDir)) {
  const pkgPath = path.join(pluginsDir, name, 'package.json')
  if (!fs.existsSync(pkgPath)) continue

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const channel = pkg.cola?.channel
  if (!channel?.id) continue

  entries.push({
    id: channel.id,
    label: channel.label ?? channel.id,
    description: channel.description,
    version: pkg.version,
    minSdkVersion: channel.minSdkVersion,
    downloadUrl: `https://github.com/marswaveai/cola-plugins/releases/download/${channel.id}@${pkg.version}/${channel.id}-${pkg.version}.tar.gz`,
  })
}

const registry = { version: 1, plugins: entries }
const outPath = path.resolve(__dirname, '..', 'registry.json')
fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
console.log(`Wrote registry.json with ${entries.length} plugin(s)`)
