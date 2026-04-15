import { assertEquals } from "@std/assert";
import { join } from "@std/path";

const forbiddenImportPattern = /(?:from|require\()\s*["']@qlever-llc\/trellis-(?!sdk\b)[^"']+["']/;

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(path);
    } else {
      yield path;
    }
  }
}

Deno.test("trellis npm artifact only depends on allowed published Trellis packages", async () => {
  const npmDir = new URL("../npm", import.meta.url);
  try {
    await Deno.stat(new URL("../npm/package.json", import.meta.url));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
  const packageJson = JSON.parse(await Deno.readTextFile(new URL("../npm/package.json", import.meta.url)));

  assertEquals(Object.keys(packageJson.dependencies).includes("@qlever-llc/result"), true);
  assertEquals(Object.keys(packageJson.dependencies).includes("@qlever-llc/trellis-sdk"), true);
  assertEquals(
    Object.keys(packageJson.dependencies).some((name: string) =>
      name.startsWith("@qlever-llc/trellis-") &&
      name !== "@qlever-llc/trellis-sdk"
    ),
    false,
  );

  for await (const filePath of walkFiles(join(npmDir.pathname, "esm"))) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const source = await Deno.readTextFile(filePath);
    assertEquals(forbiddenImportPattern.test(source), false, filePath);
  }

  for await (const filePath of walkFiles(join(npmDir.pathname, "script"))) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const source = await Deno.readTextFile(filePath);
    assertEquals(forbiddenImportPattern.test(source), false, filePath);
  }
});
