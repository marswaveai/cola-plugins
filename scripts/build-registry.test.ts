import { describe, it, expect } from "vitest";
import { entryFromPackage } from "./build-registry";

const base = "https://cdn.example.com";
const pkg = {
  version: "1.2.3",
  description: "pkg desc",
  cola: {
    plugin: { id: "demo", entry: "./dist/index.js", minSdkVersion: "0.5.0" },
    channel: {
      label: "Demo",
      description: "chan desc",
      aliases: ["d"],
      docsPath: "https://github.com/marswaveai/cola-plugins/blob/main/plugins/demo/README.md",
    },
  },
};

describe("entryFromPackage", () => {
  it("builds an OSS download URL at plugins/{id}/{id}-{version}.tar.gz", () => {
    const entry = entryFromPackage(pkg, base);
    expect(entry?.downloadUrl).toBe("https://cdn.example.com/plugins/demo/demo-1.2.3.tar.gz");
  });

  it("strips a trailing slash from the public base", () => {
    const entry = entryFromPackage(pkg, "https://cdn.example.com/");
    expect(entry?.downloadUrl).toBe("https://cdn.example.com/plugins/demo/demo-1.2.3.tar.gz");
  });

  it("prefers channel label/description over package-level fields", () => {
    const entry = entryFromPackage(pkg, base);
    expect(entry?.label).toBe("Demo");
    expect(entry?.description).toBe("chan desc");
  });

  it("copies the channel docsPath into the registry entry", () => {
    const entry = entryFromPackage(pkg, base);
    expect(entry?.docsPath).toBe(
      "https://github.com/marswaveai/cola-plugins/blob/main/plugins/demo/README.md",
    );
  });

  it("returns undefined when id/entry/version is missing", () => {
    expect(entryFromPackage({ version: "1.0.0" }, base)).toBeUndefined();
    expect(
      entryFromPackage({ cola: { plugin: { id: "x", entry: "./e.js" } } }, base),
    ).toBeUndefined();
  });
});
