import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readTranslations } from "./build-registry.js";

export async function stagePluginLocales(directory: string, staging: string) {
  const pkg = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
  const files = pkg.cola?.channel?.i18n;
  await readTranslations(directory, files);
  for (const file of Object.values(files ?? {}) as string[]) {
    const target = path.resolve(staging, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.resolve(directory, file), target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, staging] = process.argv.slice(2);
  if (!directory || !staging) throw new Error("Usage: stage-plugin-locales <plugin> <staging>");
  stagePluginLocales(directory, staging).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
