import { assert } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID = "rpc.denies-client-without-call-authority" as const;
const fixture = createRpcFixture(CASE_ID);

liveTrellisTest({
  name:
    "rpc.denies-client-without-call-authority rejects an unauthorized client RPC",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({ contract: fixture.serviceContract });

    const client = await runtime.connectClient({
      name: fixture.unauthorizedClientName,
      contract: fixture.unauthorizedClientContract,
    });

    assert((client.rpc as Record<string, unknown>).entity === undefined);
  },
});
