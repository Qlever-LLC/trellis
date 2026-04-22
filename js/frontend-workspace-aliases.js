import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

const jsRoot = dirname(fileURLToPath(import.meta.url));
const workspaceConfigPath = resolve(jsRoot, "deno.json");

function loadWorkspaceImports() {
  const contents = readFileSync(workspaceConfigPath, "utf8");
  const config = parse(contents);
  const imports = config?.imports;

  if (!imports || typeof imports !== "object") {
    throw new Error(`Expected imports in ${workspaceConfigPath}`);
  }

  return imports;
}

const workspaceAliases = Object.entries(loadWorkspaceImports())
  .filter(([name, target]) => {
    return name.startsWith("@qlever-llc/") && typeof target === "string" && target.startsWith("./");
  })
  .sort(([left], [right]) => right.length - left.length)
  .map(([find, replacement]) => ({
    find,
    replacement: resolve(jsRoot, replacement),
  }));

export function frontendWorkspaceAliases() {
  return workspaceAliases.map((alias) => ({ ...alias }));
}

export function frontendWorkspaceSvelteAliases() {
  return Object.fromEntries(
    workspaceAliases.map(({ find, replacement }) => [find, replacement]),
  );
}
