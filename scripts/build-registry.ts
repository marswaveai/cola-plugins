import fs from "node:fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { validatePluginMessageSources } from "./plugin-message-validation.js";

// 下载与 manifest 的公开根 URL(colaos OSS bucket 的 CDN 域名)。
// 可用 OSS_PUBLIC_BASE 环境变量覆盖(本地/staging)。
const DEFAULT_PUBLIC_BASE = "https://files.colaos.ai";

export type RegistryEntry = {
  id: string;
  i18n?: Record<string, Record<string, string>>;
  label: string;
  description?: string;
  version: string;
  minColaVersion?: string;
  /** @deprecated Use minColaVersion. */
  minSdkVersion?: string;
  aliases?: string[];
  docsPath?: string;
  iconUrl?: string;
  downloadUrl: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return items.length > 0 ? items : undefined;
}

export function entryFromPackage(pkg: unknown, publicBase: string): RegistryEntry | undefined {
  if (!isRecord(pkg)) return undefined;

  const cola = isRecord(pkg.cola) ? pkg.cola : undefined;
  const plugin = isRecord(cola?.plugin) ? cola.plugin : undefined;
  const channel = isRecord(cola?.channel) ? cola.channel : undefined;

  const id = normalizeString(plugin?.id);
  const entry = normalizeString(plugin?.entry);
  const version = normalizeString(pkg.version);
  if (!id || !entry || !version) return undefined;

  const label = normalizeString(channel?.label) ?? id;
  const description = normalizeString(channel?.description) ?? normalizeString(pkg.description);
  const minColaVersion = normalizeString(plugin?.minColaVersion);
  const minSdkVersion = normalizeString(plugin?.minSdkVersion);
  const aliases = normalizeStringList(channel?.aliases);
  const docsPath = normalizeString(channel?.docsPath);
  const iconUrl = normalizeString(channel?.iconUrl);
  const base = publicBase.replace(/\/+$/, "");

  return {
    id,
    label,
    ...(description ? { description } : {}),
    version,
    ...(minColaVersion ? { minColaVersion } : {}),
    ...(minSdkVersion ? { minSdkVersion } : {}),
    ...(aliases ? { aliases } : {}),
    ...(docsPath ? { docsPath } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    downloadUrl: `${base}/plugins/${id}/${id}-${version}.tar.gz`,
  };
}

export async function readTranslations(directory: string, files: unknown) {
  const resources: Record<string, Record<string, string>> = Object.create(null);
  if (files === undefined) return resources;
  if (!isRecord(files)) throw new Error("cola.channel.i18n must map locales to JSON files");
  const root = await fs.realpath(directory);
  const parameters = new Map<string, string>();
  for (const [locale, file] of Object.entries(files)) {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale) || typeof file !== "string")
      throw new Error(`Invalid translation registration: ${locale}`);
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
      throw new Error(`Translation path must be relative to the plugin: ${file}`);
    const target = await fs.realpath(path.resolve(root, file));
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !target.endsWith(".json")
    )
      throw new Error(`Translation file must be inside the plugin: ${file}`);
    if ((await fs.stat(target)).size > 1024 * 1024)
      throw new Error(`Translation file exceeds 1 MiB: ${file}`);
    const catalog: unknown = JSON.parse(await fs.readFile(target, "utf8"));
    if (!isRecord(catalog)) throw new Error(`Invalid translation catalog: ${locale}`);
    const valid: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== "string") throw new Error(`Invalid translation: ${locale}:${key}`);
      valid[key] = value;
      if (!value.trim()) continue;
      const names = [
        ...new Set([...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1])),
      ]
        .sort()
        .join(",");
      if (parameters.has(key) && parameters.get(key) !== names)
        throw new Error(`Translation parameters differ for ${locale}:${key}`);
      parameters.set(key, names);
    }
    resources[locale] = valid;
  }
  return resources;
}

export async function buildRegistry(pluginsDir: string, publicBase: string) {
  const entries: RegistryEntry[] = [];
  for (const name of await fs.readdir(pluginsDir)) {
    const dir = path.join(pluginsDir, name);
    if (!(await fs.stat(dir)).isDirectory()) continue;
    const pkgPath = path.join(dir, "package.json");
    const raw = await fs.readFile(pkgPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (raw === undefined) continue;
    const pkg = JSON.parse(raw);
    const entry = entryFromPackage(pkg, publicBase);
    if (!entry) continue;
    const resources = await readTranslations(dir, pkg.cola?.channel?.i18n);
    if (pkg.cola?.channel?.i18n) {
      await validatePluginMessageSources(path.join(dir, "src"), resources);
    }
    if (Object.keys(resources).length) {
      entry.i18n = Object.fromEntries(
        Object.entries(resources).map(([locale, catalog]) => [
          locale,
          Object.fromEntries(
            Object.entries(catalog).filter(([key]) => key === "label" || key === "description"),
          ),
        ]),
      );
    }
    entries.push(entry);
  }
  return { version: 1, plugins: entries };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

async function main() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const pluginsDir = path.resolve(moduleDir, "..", "plugins");
  const publicBase = process.env.OSS_PUBLIC_BASE || DEFAULT_PUBLIC_BASE;
  const registry = await buildRegistry(pluginsDir, publicBase);
  const outPath = path.resolve(moduleDir, "..", "registry.json");
  await fs.writeFile(outPath, JSON.stringify(registry, null, 2) + "\n");
  console.log(`Wrote registry.json with ${registry.plugins.length} plugin(s)`);
}

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
