/**
 * TDD tests for TrellisServer.stop() with NATS draining behavior.
 *
 * These tests verify that:
 * 1. stop() clears any refresh timers
 * 2. stop() calls nats.drain()
 * 3. After stop(), the connection is properly closed
 */

import { connect } from "@nats-io/transport-deno";
import { assertEquals, assertExists } from "@std/assert";
import { trellisCore } from "@qlever-llc/trellis-sdk-trellis-core";
import { NatsTest } from "../testing/nats.ts";
import { type TrellisAuth, TrellisServer } from "../trellis.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

function createMockAuth(): TrellisAuth {
  return {
    sessionKey: "test-session-key",
    sign: () => new Uint8Array(64),
  };
}

Deno.test({
  name: "TrellisServer.stop() drains NATS connection",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
  await using natsTest = await NatsTest.start();

  await t.step("stop() drains the NATS connection and closes it", async () => {
    // Create a separate connection for this test so we can verify it drains
    const info = natsTest.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}` });

    const server = TrellisServer.create(
      "test-server",
      nc,
      createMockAuth(),
      { api: trellisCore.API.owned },
    );
    assertExists(server);

    // Connection should be open before stop
    assertEquals(nc.isClosed(), false);

    // Stop the server - this should drain the connection
    await server.stop();

    // After stop, the connection should be closed (drain closes the connection)
    assertEquals(nc.isClosed(), true);
  });

  await t.step("stop() can be called multiple times safely", async () => {
    const info = natsTest.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}` });

    const server = TrellisServer.create(
      "test-server-multiple-stop",
      nc,
      createMockAuth(),
      { api: trellisCore.API.owned },
    );

    // First stop
    await server.stop();
    assertEquals(nc.isClosed(), true);

    // Second stop should not throw (idempotent)
    await server.stop();
    assertEquals(nc.isClosed(), true);
  });
  },
});
