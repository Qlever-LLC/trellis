import { assertEquals } from "@std/assert";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { ContractStore } from "../../catalog/store.ts";
import { createAuthListCapabilitiesHandler } from "./users.ts";

const logger = { trace: () => {} };

Deno.test("Auth.ListCapabilities returns platform and active contract capabilities", async () => {
  const store = new ContractStore();
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
  store.activate("digest-auth", contract);

  const result = await createAuthListCapabilitiesHandler(store, logger)({
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
