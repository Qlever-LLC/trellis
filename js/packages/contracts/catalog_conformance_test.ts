import { assertEquals } from "@std/assert";

Deno.test("packed catalog matches shared contract conformance fixture", async () => {
  const packed = JSON.parse(
    await Deno.readTextFile(
      new URL("../../../generated/contracts/dist/catalog.v1.json", import.meta.url),
    ),
  );
  const fixture = JSON.parse(
    await Deno.readTextFile(
      new URL("./testdata/active-catalog.json", import.meta.url),
    ),
  );

  assertEquals(packed, fixture);
});
