import { assertEquals } from "@std/assert";
import { Type } from "typebox";
import { encodeSchema } from "../codec.ts";
import { defineContract } from "../contract.ts";
import { err, UnexpectedError } from "../index.ts";

Deno.test("API composition", async (t) => {
  const emptySchema = Type.Object({}, { additionalProperties: false });
  const catalogContract = defineContract({
    id: "trellis.core.test@v1",
    displayName: "Core Test",
    description: "Expose a catalog RPC for API composition tests.",
    kind: "service",
    schemas: {
      Empty: emptySchema,
    },
    rpc: {
      "Trellis.Catalog": {
        version: "v1",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
      },
    },
  });

  await t.step("createClient uses only contract-derived runtime APIs", () => {
    const app = defineContract({
      id: "trellis.app.test@v1",
      displayName: "App Test",
      description: "Exercise runtime APIs without declared dependencies.",
      kind: "app",
    });

    assertEquals(Object.hasOwn(app.API.trellis.rpc, "Trellis.Catalog"), false);
  });

  await t.step("contract-derived uses populate the outbound surface", () => {
    const app = defineContract({
      id: "trellis.app.used.test@v1",
      displayName: "App Used Test",
      description: "Exercise API composition with declared dependency uses.",
      kind: "app",
      uses: {
        core: catalogContract.use({ rpc: { call: ["Trellis.Catalog"] } }),
      },
    });

    assertEquals(typeof app.API.trellis.rpc["Trellis.Catalog"].subject, "string");
    assertEquals(Object.hasOwn(app.API.trellis.rpc, "Trellis.Catalog"), true);
  });

  await t.step("Unknown RPC key produces UnexpectedError shape (no throw)", () => {
    // We don't construct a full Trellis instance here; we just ensure the
    // diagnostic error format we rely on is stable.
    const e = err(
      new UnexpectedError({
        cause: new Error("Unknown RPC method 'Test.Unknown'. Did you forget to include its API module?"),
        context: { method: "Test.Unknown" },
      }),
    );
    assertEquals(e.isErr(), true);
    assertEquals(e.error.name, "UnexpectedError");
  });

  await t.step("Encoding a schema error is deterministic (sanity)", () => {
    const schema = Type.Object({ x: Type.Number() }, { additionalProperties: false });
    const r = encodeSchema(schema, JSON.parse('{"x":"nope"}'));
    assertEquals(r.isErr(), true);
  });
});
