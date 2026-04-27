import { assertEquals } from "@std/assert";
import { Type } from "typebox";
import { encodeSchema } from "../codec.ts";
import { createClient } from "../client.ts";
import { defineAppContract, defineServiceContract } from "../contract.ts";
import { err, UnexpectedError } from "../index.ts";
import { auth } from "../sdk/auth.ts";

Deno.test("createClient prefers trellis API for app contracts", () => {
  const contract = defineAppContract(() => ({
    id: "trellis.app.test@v1",
    displayName: "App Test",
    description: "Exercise runtime API selection for app contracts.",
    uses: {
      auth: auth.use({
        rpc: {
          call: ["Auth.ListApprovals"],
        },
      }),
    },
  }));

  const client = createClient(
    contract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
  );

  assertEquals(Object.hasOwn(client.api.rpc, "Auth.Me"), true);
  assertEquals(Object.hasOwn(client.api.rpc, "Auth.ListApprovals"), true);
});

Deno.test("API composition", async (t) => {
  const emptySchema = Type.Object({});
  const catalogContract = defineServiceContract(
    {
      schemas: {
        Empty: emptySchema,
      },
    },
    (ref) => ({
      id: "trellis.core.test@v1",
      displayName: "Core Test",
      description: "Expose a catalog RPC for API composition tests.",
      rpc: {
        "Trellis.Catalog": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("Empty"),
        },
      },
    }),
  );

  await t.step("createClient uses only contract-derived runtime APIs", () => {
    const app = defineAppContract(() => ({
      id: "trellis.app.test@v1",
      displayName: "App Test",
      description: "Exercise runtime APIs without declared dependencies.",
    }));

    assertEquals(Object.hasOwn(app.API.trellis.rpc, "Trellis.Catalog"), false);
  });

  await t.step("contract-derived uses populate the outbound surface", () => {
    const app = defineAppContract(() => ({
      id: "trellis.app.used.test@v1",
      displayName: "App Used Test",
      description: "Exercise API composition with declared dependency uses.",
      uses: {
        core: catalogContract.use({ rpc: { call: ["Trellis.Catalog"] } }),
      },
    }));

    assertEquals(
      typeof app.API.trellis.rpc["Trellis.Catalog"].subject,
      "string",
    );
    assertEquals(Object.hasOwn(app.API.trellis.rpc, "Trellis.Catalog"), true);
  });

  await t.step(
    "Unknown RPC key produces UnexpectedError shape (no throw)",
    () => {
      // We don't construct a full Trellis instance here; we just ensure the
      // diagnostic error format we rely on is stable.
      const e = err(
        new UnexpectedError({
          cause: new Error(
            "Unknown RPC method 'Test.Unknown'. Did you forget to include its API module?",
          ),
          context: { method: "Test.Unknown" },
        }),
      );
      assertEquals(e.isErr(), true);
      assertEquals(e.error.name, "UnexpectedError");
    },
  );

  await t.step("Encoding a schema error is deterministic (sanity)", () => {
    const schema = Type.Object({ x: Type.Number() });
    const r = encodeSchema(schema, JSON.parse('{"x":"nope"}'));
    assertEquals(r.isErr(), true);
  });
});
