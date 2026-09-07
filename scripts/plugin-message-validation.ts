import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";

function parameters(text: string) {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]))]
    .sort()
    .join(",");
}

// Inspect source without importing plugins or running their initialization code.
export async function validatePluginMessageSources(
  directory: string,
  resources: Record<string, Record<string, string>>,
) {
  async function visitDirectory(dir: string) {
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map(async (entry) => {
        const filename = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!["node_modules", "tests", "__tests__"].includes(entry.name))
            await visitDirectory(filename);
          return;
        }
        if (
          !entry.isFile() ||
          !/\.[cm]?[jt]sx?$/.test(entry.name) ||
          /\.(?:d|test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
        )
          return;
        const source = ts.createSourceFile(
          filename,
          await readFile(filename, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const factories = new Set<string>();
        const namespaces = new Set<string>();
        for (const statement of source.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
            continue;
          const module = statement.moduleSpecifier.text;
          if (
            module !== "@marswave/cola-plugin-sdk" &&
            !module.startsWith("@marswave/cola-plugin-sdk/source")
          )
            continue;
          const bindings = statement.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements) {
              if ((binding.propertyName ?? binding.name).text === "pluginMessage")
                factories.add(binding.name.text);
            }
          } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        }
        function visit(node: ts.Node) {
          if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const isFactory = ts.isIdentifier(callee)
              ? factories.has(callee.text)
              : ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                namespaces.has(callee.expression.text) &&
                callee.name.text === "pluginMessage";
            if (isFactory) {
              const [key, fallback] = node.arguments;
              const location = `${filename}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
              if (!key || !ts.isStringLiteralLike(key)) {
                throw new Error(
                  `${location}: pluginMessage key must be a string literal for translation validation`,
                );
              }
              if (key.text) {
                if (!fallback || !ts.isStringLiteralLike(fallback)) {
                  throw new Error(
                    `${location}: pluginMessage key and fallback must be string literals for translation validation`,
                  );
                }
                for (const [locale, catalog] of Object.entries(resources)) {
                  const translated = Object.hasOwn(catalog, key.text)
                    ? catalog[key.text]
                    : undefined;
                  if (translated?.trim() && parameters(translated) !== parameters(fallback.text)) {
                    throw new Error(
                      `${location}: Translation parameters differ from code fallback for ${locale}:${key.text}`,
                    );
                  }
                }
              }
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }),
    );
  }
  await visitDirectory(directory);
}
