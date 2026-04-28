import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertThrows } from "@std/assert";

import { createActiveContractLookup } from "./uses.ts";

function makeRpcContract(
  capabilities: string[],
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "graph@v1",
    displayName: "Graph",
    description: "Graph test contract",
    kind: "service",
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
    },
    rpc: {
      Ping: {
        version: "v1",
        subject: "rpc.v1.Graph.Ping",
        input: { schema: "Input" },
        output: { schema: "Output" },
        capabilities: { call: capabilities },
      },
    },
  };
}

Deno.test("active compatible projection rejects divergent RPC capabilities", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        { digest: "graph-a", contract: makeRpcContract(["graph.read"]) },
        {
          digest: "graph-b",
          contract: makeRpcContract(["graph.read", "graph.admin"]),
        },
      ]),
    Error,
    "different capabilities",
  );
});
