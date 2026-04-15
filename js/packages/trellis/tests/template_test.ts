import { connect } from "@nats-io/transport-deno";
import { assertEquals } from "@std/assert";
import { createClient } from "../client.ts";
import { defineContract } from "../contract.ts";
import { NatsTest } from "../testing/nats.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

Deno.test({
  name: "subject templating",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
  await using nats = await NatsTest.start();
  const info = nats.nc.info!;
  const nc = await connect({ servers: `localhost:${info.port}` });

  try {
    const contract = defineContract(
      {},
      () => ({
        id: "trellis.template.test@v1",
        displayName: "Template Test",
        description: "Exercise template subject parameters in tests.",
        kind: "service",
      }),
    );

    const client = createClient(
      contract,
      nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "client" },
    );

    await t.step("escapes forbidden subject tokens", () => {
      const r = client.template("rpc.{/id}", { id: "a.b" });
      assertEquals(r.isOk(), true);
      assertEquals(r.take(), "rpc.a~2E~b");
    });

    await t.step("treats 0 and empty string as present", () => {
      const r0 = client.template("rpc.{/id}", { id: 0 });
      assertEquals(r0.isOk(), true);
      assertEquals(r0.take(), "rpc.0");

      const rEmpty = client.template("rpc.{/id}", { id: "" });
      assertEquals(rEmpty.isOk(), true);
      // Empty tokens are prefixed to avoid invalid subjects.
      assertEquals(rEmpty.take(), "rpc._");
    });

    await t.step("allows wildcards when missing", () => {
      const r = client.template("rpc.{/id}", {}, true);
      assertEquals(r.isOk(), true);
      assertEquals(r.take(), "rpc.*");
    });
  } finally {
    await nc.drain();
  }
  },
});
