import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse } from "jsonc-parser";

Deno.test("root package import does not require the trellis-sdk package", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceConfigUrl = new URL("../../../deno.json", import.meta.url);
    const baseConfig = parse(
      await Deno.readTextFile(workspaceConfigUrl),
    ) as { imports?: Record<string, string> };
    const packageConfigUrl = new URL("../deno.json", import.meta.url);
    const packageConfig = parse(
      await Deno.readTextFile(packageConfigUrl),
    ) as { exports?: Record<string, string> };
    const imports = Object.fromEntries(
      Object.entries(baseConfig.imports ?? {}).map(([key, value]) => [
        key,
        value.startsWith(".") ? new URL(value, workspaceConfigUrl).href : value,
      ]),
    );
    const trellisImports = Object.fromEntries(
      Object.entries(packageConfig.exports ?? {}).map(([key, value]) => [
        key === "."
          ? "@qlever-llc/trellis"
          : `@qlever-llc/trellis${key.slice(1)}`,
        new URL(value, packageConfigUrl).href,
      ]),
    );
    const configPath = join(tempDir, "deno.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({
        imports: {
          ...imports,
          ...trellisImports,
          "@qlever-llc/result": new URL("../../result/mod.ts", import.meta.url)
            .href,
          "@qlever-llc/trellis/sdk/core":
            "./missing/generated/trellis-core/mod.ts",
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
