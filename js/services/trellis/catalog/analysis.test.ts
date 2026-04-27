import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals } from "@std/assert";

import { analyzeContract } from "./analysis.ts";

Deno.test("contract analysis summary includes store resources", () => {
  const contract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "files@v1",
    displayName: "Files",
    description: "Files test contract",
    kind: "service",
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploads",
        },
      },
    },
  };

  const analyzed = analyzeContract(contract);

  assertEquals(analyzed.summary.storeResources, 1);
  assertEquals(analyzed.analysis.resources.store.map((store) => store.alias), [
    "uploads",
  ]);
});
