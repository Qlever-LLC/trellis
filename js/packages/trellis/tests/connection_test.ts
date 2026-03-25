import { assertEquals, assertExists } from "@std/assert";
import { NatsTest } from "../testing/nats.ts";
import { Trellis, type TrellisAuth } from "../trellis.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

function createMockAuth(token = "test-token"): TrellisAuth {
  return {
    sessionKey: token,
    sign: () => new Uint8Array(64),
  };
}

Deno.test({
  name: "Trellis with external NATS connection",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
  await using nats = await NatsTest.start();

  await t.step("constructor accepts external NATS connection", () => {
    const trellis = new Trellis("test-client", nats.nc, createMockAuth());
    assertExists(trellis);
    assertEquals(trellis.name, "test-client");
  });

  await t.step("natsConnection getter returns the connection", () => {
    const trellis = new Trellis("test-client", nats.nc, createMockAuth());
    assertExists(trellis.natsConnection);
    assertEquals(trellis.natsConnection, nats.nc);
  });

  await t.step("connection lifecycle is managed by caller", async () => {
    const { connect } = await import("@nats-io/transport-deno");
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}` });

    const trellis = new Trellis("test-client", nc, createMockAuth());
    assertExists(trellis.natsConnection);
    assertEquals(nc.isClosed(), false);

    await nc.drain();
    assertEquals(nc.isClosed(), true);
  });
  },
});
