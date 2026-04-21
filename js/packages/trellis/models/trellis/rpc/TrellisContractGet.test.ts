import { assertEquals } from "@std/assert";
import { Value } from "typebox/value";

import { TrellisContractGetResponseSchema } from "./TrellisContractGet.ts";

Deno.test("TrellisContractGetResponseSchema accepts top-level jobs", () => {
  const response = {
    contract: {
      format: "trellis.contract.v1",
      id: "svc.example@v1",
      displayName: "Example Service",
      description: "Example service contract",
      kind: "service",
      jobs: {
        process: {
          payload: { schema: "JobPayload" },
        },
      },
    },
  };

  assertEquals(Value.Check(TrellisContractGetResponseSchema, response), true);
});

Deno.test("TrellisContractGetResponseSchema rejects malformed top-level jobs", () => {
  const response = {
    contract: {
      format: "trellis.contract.v1",
      id: "svc.example@v1",
      displayName: "Example Service",
      description: "Example service contract",
      kind: "service",
      jobs: {
        process: {
          invalid: true,
        },
      },
    },
  };

  assertEquals(Value.Check(TrellisContractGetResponseSchema, response), false);
});

Deno.test("TrellisContractGetResponseSchema accepts operations and kind", () => {
  const response = {
    contract: {
      format: "trellis.contract.v1",
      id: "svc.example@v1",
      displayName: "Example Service",
      description: "Example service contract",
      kind: "service",
      operations: {
        Refresh: {
          version: "v1",
          subject: "operations.v1.Example.Refresh",
          input: { schema: "RefreshInput" },
        },
      },
    },
  };

  assertEquals(Value.Check(TrellisContractGetResponseSchema, response), true);
});

Deno.test("TrellisContractGetResponseSchema rejects legacy resources.jobs", () => {
  const response = {
    contract: {
      format: "trellis.contract.v1",
      id: "svc.example@v1",
      displayName: "Example Service",
      description: "Example service contract",
      kind: "service",
      resources: {
        jobs: {
          queues: {
            process: {
              payload: { schema: "JobPayload" },
            },
          },
        },
      },
    },
  };

  assertEquals(Value.Check(TrellisContractGetResponseSchema, response), false);
});
