import { assertEquals } from "@std/assert";
import { canonicalizeJson, type JsonValue } from "@qlever-llc/trellis/contracts";
import { CONTRACT as AUTH_CONTRACT } from "./contracts/trellis_auth.ts";
import { CONTRACT as CORE_CONTRACT } from "./contracts/trellis_core.ts";
import { CONTRACT as STATE_CONTRACT } from "./contracts/trellis_state.ts";

const manifests: [string, unknown][] = [
  ["trellis.auth@v1.json", AUTH_CONTRACT],
  ["trellis.core@v1.json", CORE_CONTRACT],
  ["trellis.state@v1.json", STATE_CONTRACT],
];

for (const [filename, contract] of manifests) {
  Deno.test(`${filename} matches emitted contract`, async () => {
    const onDisk = (await Deno.readTextFile(
      new URL(`../../../generated/contracts/manifests/${filename}`, import.meta.url),
    )).trim();
    const emitted = canonicalizeJson(contract as JsonValue);
    assertEquals(
      onDisk,
      emitted,
      `${filename} is out of sync with the generated contract output. Run: deno task -c js/deno.json prepare`,
    );
  });
}
