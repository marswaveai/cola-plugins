import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRegistry, readTranslations } from "./build-registry.js";
import { stagePluginLocales } from "./stage-plugin-locales.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cola-registry-i18n-"));
  temporary.push(root);
  const plugin = path.join(root, "plugins/example");
  await mkdir(path.join(plugin, "translations"), { recursive: true });
  await mkdir(path.join(plugin, "src"));
  await writeFile(
    path.join(plugin, "src/index.ts"),
    `
    import { pluginMessage as m } from '@marswave/cola-plugin-sdk';
    m('auth.wait', 'Wait {{seconds}} seconds');
  `,
  );
  const pkg = {
    version: "1.0.0",
    cola: {
      plugin: { id: "example", entry: "./dist/index.js" },
      channel: {
        label: "Example",
        i18n: { en: "./translations/en.json", "zh-CN": "./translations/zh-CN.json" },
      },
    },
  };
  await writeFile(path.join(plugin, "package.json"), JSON.stringify(pkg));
  await writeFile(
    path.join(plugin, "translations/en.json"),
    JSON.stringify({ label: "Example", "auth.wait": "Wait {{seconds}} seconds" }),
  );
  await writeFile(
    path.join(plugin, "translations/zh-CN.json"),
    JSON.stringify({ label: "示例", description: "中文简介", "auth.wait": "等待 {{seconds}} 秒" }),
  );
  return { root, plugin, pkg };
}

describe("plugin translation publication", () => {
  it("publishes store text without runtime catalogs and packages every registered file", async () => {
    const { root, plugin, pkg } = await fixture();
    const registry = await buildRegistry(path.join(root, "plugins"), "https://files.example.com");
    expect(registry.plugins[0]?.i18n).toEqual({
      en: { label: "Example" },
      "zh-CN": { label: "示例", description: "中文简介" },
    });
    const staging = path.join(root, "staging");
    await stagePluginLocales(plugin, staging);
    const installed = await readTranslations(staging, pkg.cola.channel.i18n);
    expect(installed["zh-CN"]?.["auth.wait"]).toBe("等待 {{seconds}} 秒");
    expect(await readFile(path.join(staging, "translations/en.json"), "utf8")).toContain("Wait");
  });

  it("rejects missing files and inconsistent interpolation parameters before publication", async () => {
    const { root, plugin } = await fixture();
    await writeFile(
      path.join(plugin, "translations/zh-CN.json"),
      JSON.stringify({ "auth.wait": "等待 {{minutes}} 分钟" }),
    );
    await expect(
      buildRegistry(path.join(root, "plugins"), "https://files.example.com"),
    ).rejects.toThrow("parameters differ");
    await expect(readTranslations(plugin, { ja: "./missing.json" })).rejects.toThrow();
    await expect(readTranslations(plugin, { en: "../outside.json" })).rejects.toThrow("relative");
  });

  it("runs the release staging command through tsx and fails on invalid catalogs", async () => {
    const { root, plugin, pkg } = await fixture();
    const staging = path.join(root, "release");
    const command = path.resolve("node_modules/.bin/tsx");
    const args = ["scripts/stage-plugin-locales.ts", plugin, staging];
    await promisify(execFile)(command, args);
    expect((await readTranslations(staging, pkg.cola.channel.i18n))["zh-CN"]?.label).toBe("示例");
    await writeFile(path.join(plugin, "translations/zh-CN.json"), "invalid");
    await expect(promisify(execFile)(command, args)).rejects.toThrow("Command failed");
  });

  it("rejects catalogs that agree with each other but no longer match the source fallback", async () => {
    const { root, plugin } = await fixture();
    await writeFile(
      path.join(plugin, "src/index.ts"),
      `
      import { pluginMessage as localized } from '@marswave/cola-plugin-sdk';
      localized('auth.wait', 'Wait {{minutes}} minutes');
    `,
    );
    await expect(
      buildRegistry(path.join(root, "plugins"), "https://files.example.com"),
    ).rejects.toThrow("parameters differ from code fallback for en:auth.wait");
    await expect(stagePluginLocales(plugin, path.join(root, "staging"))).rejects.toThrow(
      "parameters differ from code fallback",
    );
    await expect(
      promisify(execFile)(path.resolve("node_modules/.bin/tsx"), [
        "scripts/stage-plugin-locales.ts",
        plugin,
        path.join(root, "release"),
      ]),
    ).rejects.toThrow("parameters differ from code fallback");
  });
  it("ignores shadowed SDK aliases but still validates calls to the imported bindings", async () => {
    const { root, plugin } = await fixture();
    await writeFile(
      path.join(plugin, "src/index.ts"),
      `
      import { pluginMessage as m } from '@marswave/cola-plugin-sdk';
      import * as sdk from '@marswave/cola-plugin-sdk';
      function parameter(m: any, value: string) { return m(value); }
      { const m = (value: string) => value; m(dynamicValue); }
      try {} catch (m) { m(dynamicValue); }
      function namespace(sdk: any) { return sdk.pluginMessage(dynamicKey); }
      function hoisted(value: string) { m(value); function m(value: string) { return value; } }
      m('auth.wait', 'Wait {{seconds}} seconds');
      sdk.pluginMessage('auth.wait', 'Wait {{seconds}} seconds');
    `,
    );
    await expect(
      buildRegistry(path.join(root, "plugins"), "https://files.example.com"),
    ).resolves.toMatchObject({ version: 1 });
    await expect(stagePluginLocales(plugin, path.join(root, "staging"))).resolves.toBeUndefined();
    await writeFile(
      path.join(plugin, "translations/en.json"),
      JSON.stringify({ "auth.wait": "Wait {{minutes}} minutes" }),
    );
    await expect(
      buildRegistry(path.join(root, "plugins"), "https://files.example.com"),
    ).rejects.toThrow("parameters differ");
  });
});
