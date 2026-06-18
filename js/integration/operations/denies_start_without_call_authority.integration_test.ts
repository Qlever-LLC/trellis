import { assert } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.denies-start-without-call-authority" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.denies-start-without-call-authority rejects an unauthorized operation start",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({ contract: fixture.serviceContract });

    const client = await runtime.connectClient({
      name: fixture.unauthorizedClientName,
      contract: fixture.unauthorizedClientContract,
    });

    assert((client.operation as Record<string, unknown>).entity === undefined);
  },
});
