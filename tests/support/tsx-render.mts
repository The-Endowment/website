import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Render-test loader only: compile the real TSX modules and resolve their @/
 * imports locally. Mocks are scoped to one load; React and its renderer remain
 * real, and no global require hooks or production files are changed. */
export function loadTsxModule<T>(relativePath: string, mocks: Record<string, unknown>): T {
  const cache = new Map<string, { exports: unknown }>();
  function load(filename: string): unknown {
    const previous = cache.get(filename);
    if (previous) return previous.exports;
    const compiled = { exports: {} as unknown };
    cache.set(filename, compiled);
    const nativeRequire = createRequire(filename);
    const require = (specifier: string): unknown => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return nativeRequire(specifier);
      const local = specifier.startsWith("@/")
        ? resolve(root, specifier.slice(2)) : resolve(dirname(filename), specifier);
      const target = extname(local) ? local
        : [local + ".tsx", local + ".ts"].find(existsSync) ?? nativeRequire.resolve(local);
      return /\.[cm]?tsx?$/.test(target) ? load(target) : nativeRequire(target);
    };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    new Function("exports", "require", "module", "__filename", "__dirname", outputText)(compiled.exports, require, compiled, filename, dirname(filename));
    return compiled.exports;
  }
  return load(resolve(root, relativePath)) as T;
}
