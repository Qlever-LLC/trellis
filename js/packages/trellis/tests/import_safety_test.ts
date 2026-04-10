import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse } from "jsonc-parser";

Deno.test("root package import does not require the generated core SDK", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceConfigUrl = new URL("../../../deno.json", import.meta.url);
    const baseConfig = parse(
      await Deno.readTextFile(workspaceConfigUrl),
    ) as { imports?: Record<string, string> };
    const imports = Object.fromEntries(
      Object.entries(baseConfig.imports ?? {}).map(([key, value]) => [
        key,
        value.startsWith(".") ? new URL(value, workspaceConfigUrl).href : value,
      ]),
    );
    const configPath = join(tempDir, "deno.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({
        imports: {
          ...imports,
          "@qlever-llc/trellis-sdk-core": "./missing/generated/trellis-core/mod.ts",
        },
        nodeModulesDir: "auto",
      }),
    );

    const modulePath = new URL("../index.ts", import.meta.url).pathname;
    const script =
      "const [modulePath] = Deno.args; await import(new URL(modulePath, 'file:///').href);";

    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--quiet", "--config", configPath, script, modulePath],
      stderr: "piped",
      stdout: "null",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
