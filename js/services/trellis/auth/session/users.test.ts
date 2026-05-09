import { assertEquals } from "@std/assert";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import { createAuthCapabilitiesListHandler } from "./users.ts";

const logger = { trace: () => {} };

Deno.test("Auth.Capabilities.List returns platform and active contract capabilities", async () => {
  const contracts = createTestContracts();
  const contract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Auth contract.",
    kind: "service",
    capabilities: {
      "trellis.auth::device.review": {
        displayName: "Review device activation",
        description: "Review and decide pending device activation requests.",
      },
    },
  };
  contracts.activateTestContract({ digest: "digest-auth", contract });

  const result = await createAuthCapabilitiesListHandler(contracts, logger)({
    input: { limit: 10 },
    context: {
      caller: {
        type: "user",
        origin: "github",
        id: "admin",
        capabilities: ["admin"],
      },
    },
  });

  assertEquals(result.take(), {
    capabilities: [{
      key: "admin",
      displayName: "Administer Trellis",
      description:
        "Manage Trellis users, sessions, deployments, and runtime policy.",
      source: "platform",
    }, {
      key: "trellis.auth::device.review",
      displayName: "Review device activation",
      description: "Review and decide pending device activation requests.",
      source: "contract",
      contractId: "trellis.auth@v1",
      contractDigest: "digest-auth",
      contractDisplayName: "Trellis Auth",
    }],
  });
});
