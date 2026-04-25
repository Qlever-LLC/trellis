import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

const jsRoot = dirname(fileURLToPath(import.meta.url));
const workspaceConfigPath = resolve(jsRoot, "deno.json");
const defaultLocalImportPrefixes = ["@qlever-llc/", "#"];

function loadWorkspaceImports(configPath) {
  const contents = readFileSync(configPath, "utf8");
  const config = parse(contents);
  const imports = config?.imports;

  if (!imports || typeof imports !== "object") {
    throw new Error(`Expected imports in ${configPath}`);
  }

  return imports;
}

function buildWorkspaceAliases(options = {}) {
  const configPath = options.configPath
    ? resolve(options.configPath)
    : workspaceConfigPath;
  const configRoot = dirname(configPath);
  const localImportPrefixes = options.localImportPrefixes ??
    defaultLocalImportPrefixes;

  return Object.entries(loadWorkspaceImports(configPath))
    .filter(([name, target]) => {
      return localImportPrefixes.some((prefix) => name.startsWith(prefix)) &&
        typeof target === "string" && target.startsWith(".");
    })
    .sort(([left], [right]) => right.length - left.length)
    .map(([find, replacement]) => ({
      find,
      replacement: resolve(configRoot, replacement),
    }));
}

/**
 * Build Vite aliases for local Deno workspace/package imports.
 *
 * Use this from frontend apps that consume local workspace packages or generated
 * SDKs so Vite resolves the same package specifiers as Deno.
 */
export function frontendWorkspaceAliases(options = {}) {
  return buildWorkspaceAliases(options).map((alias) => ({ ...alias }));
}

/**
 * Build SvelteKit aliases for local Deno workspace/package imports.
 *
 * SvelteKit writes these aliases into `.svelte-kit/tsconfig.json`, which keeps
 * the editor and `svelte-check` on the same local package graph as Vite/Deno.
 */
export function frontendWorkspaceSvelteAliases(options = {}) {
  return Object.fromEntries(
    buildWorkspaceAliases(options).map(({ find, replacement }) => [
      find,
      replacement,
    ]),
  );
}
