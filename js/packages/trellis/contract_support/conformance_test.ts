import { assertEquals } from "@std/assert";

import { canonicalizeJson, digestJson, type JsonValue } from "./canonical.ts";
import { digestContractManifest, type TrellisContractV1 } from "./mod.ts";

Deno.test("canonical json matches shared vectors", async () => {
  const fixtures = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../conformance/canonical-json/vectors.json",
        import.meta.url,
      ),
    ),
  ) as Array<{
    name: string;
    input: JsonValue;
    canonical: string;
    digest: string;
  }>;

  for (const fixture of fixtures) {
    assertEquals(
      canonicalizeJson(fixture.input),
      fixture.canonical,
      fixture.name,
    );
    assertEquals(
      (await digestJson(fixture.input)).digest,
      fixture.digest,
      fixture.name,
    );
  }
});

Deno.test("contract digest matches shared vectors", async () => {
  const fixtures = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../conformance/contract-digest/vectors.json",
        import.meta.url,
      ),
    ),
  ) as Array<{
    name: string;
    input: TrellisContractV1;
    digest: string;
  }>;

  for (const fixture of fixtures) {
    assertEquals(
      digestContractManifest(fixture.input),
      fixture.digest,
      fixture.name,
    );
  }
});
