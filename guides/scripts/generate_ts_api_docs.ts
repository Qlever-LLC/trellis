const repoRoot = new URL("../../", import.meta.url);
const jsRoot = new URL("js/", repoRoot);
const output = new URL("guides/static/api/typescript", repoRoot);
const outputParent = new URL("./", output);
const packageConfigUrl = new URL("packages/trellis/deno.json", jsRoot);

interface TrellisPackageConfig {
  exports: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTrellisPackageConfig(
  value: unknown,
): value is TrellisPackageConfig {
  if (!isRecord(value) || !isRecord(value.exports)) {
    return false;
  }

  return Object.values(value.exports).every((exportPath) =>
    typeof exportPath === "string"
  );
}

const packageConfig: unknown = JSON.parse(
  await Deno.readTextFile(packageConfigUrl),
);

if (!isTrellisPackageConfig(packageConfig)) {
  throw new Error(
    "Expected packages/trellis/deno.json to contain string exports",
  );
}

const entrypoints = [...new Set(Object.values(packageConfig.exports))].map(
  (exportPath) => `packages/trellis/${exportPath.replace(/^\.\//, "")}`,
);

await Deno.mkdir(outputParent, { recursive: true });
await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) {
    throw error;
  }
});

const command = new Deno.Command(Deno.execPath(), {
  cwd: jsRoot,
  args: [
    "doc",
    "--html",
    "--quiet",
    "--name=Trellis TypeScript API",
    "--output=../guides/static/api/typescript",
    ...entrypoints,
  ],
});

const result = await command.spawn().status;
if (!result.success) {
  Deno.exit(result.code);
}

console.log(
  `Generated TypeScript API docs for ${entrypoints.length} package entrypoints`,
);
