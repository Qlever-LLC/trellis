import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

Deno.test("contracts pack tool produces catalog", async () => {
  const root = fromFileUrl(new URL("..", import.meta.url));
  const generatedRoot = fromFileUrl(new URL("../../../../generated", import.meta.url));
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "task",
      "-c",
      "../../deno.json",
      "contracts:pack",
    ],
    cwd: root,
  });
  const res = await cmd.output();
  assertEquals(res.code, 0);

  const catalogPath = join(generatedRoot, "contracts", "dist", "catalog.v1.json");
  const text = await Deno.readTextFile(catalogPath);
  const json = JSON.parse(text) as Record<string, unknown>;
  assertEquals(json.format, "trellis.catalog.v1");
  assertExists(json.contracts);
});
