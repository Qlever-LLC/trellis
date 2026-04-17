import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, toFileUrl } from "@std/path";

import { canonicalizeJson, type JsonValue } from "../mod.ts";

Deno.test("emit-contract writes canonical manifest from source contract module", async () => {
  const toolsDir = dirname(fromFileUrl(import.meta.url));
  const repoRoot = join(toolsDir, "../../../../../");
  const tempDir = await Deno.makeTempDir({ prefix: "trellis-contract-source-" });
  const outPath = join(tempDir, "trellis.activity@v1.json");

  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "-c",
      join(repoRoot, "js/deno.json"),
      join(repoRoot, "js/packages/trellis/contract_support/tools/emit_contract.ts"),
      "--source",
      join(repoRoot, "js/services/activity/contracts/trellis_activity.ts"),
      "--out",
      outPath,
    ],
    cwd: repoRoot,
  });

  const result = await command.output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));

  const emitted = (await Deno.readTextFile(outPath)).trim();
  const { CONTRACT } = await import(
    toFileUrl(join(repoRoot, "js/services/activity/contracts/trellis_activity.ts")).href,
  );
  assertEquals(emitted, canonicalizeJson(CONTRACT as JsonValue));
});
