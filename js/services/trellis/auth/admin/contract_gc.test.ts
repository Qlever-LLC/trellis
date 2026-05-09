import { assertEquals } from "@std/assert";

import { purgeUnusedInstalledContracts } from "./contract_gc.ts";

Deno.test("unused installed contract cleanup only queries candidate references", async () => {
  const deleted: string[] = [];
  const requested: Record<string, string[]> = {};

  await purgeUnusedInstalledContracts(["sha256-a", "sha256-b", "builtin"], {
    builtinContractDigests: ["builtin"],
    contractStorage: {
      delete: (digest) => {
        deleted.push(digest);
        return Promise.resolve();
      },
    },
    serviceDeploymentStorage: {
      listByDeploymentIds: (deploymentIds) => {
        requested.serviceDeployments = [...deploymentIds];
        return Promise.resolve([{ deploymentId: "svc-a", disabled: false }]);
      },
    },
    deviceDeploymentStorage: {
      listByDeploymentIds: (deploymentIds) => {
        requested.deviceDeployments = [...deploymentIds];
        return Promise.resolve([]);
      },
    },
    deploymentContractEvidenceStorage: {
      listByDigests: (contractDigests) => {
        requested.evidence = [...contractDigests];
        return Promise.resolve([
          {
            deploymentId: "svc-a",
            contractId: "svc@v1",
            contractDigest: "sha256-a",
          },
        ]);
      },
    },
    serviceInstanceStorage: {
      listByCurrentContractDigests: (contractDigests) => {
        requested.serviceInstances = [...contractDigests];
        return Promise.resolve([]);
      },
    },
    sessionStorage: {
      listEntriesByContractDigests: (contractDigests) => {
        requested.sessions = [...contractDigests];
        return Promise.resolve([]);
      },
    },
    contractApprovalStorage: {
      listByApprovalEvidenceContractDigests: (contractDigests) => {
        requested.approvals = [...contractDigests];
        return Promise.resolve([]);
      },
    },
  });

  assertEquals(requested, {
    evidence: ["sha256-a", "sha256-b"],
    serviceDeployments: ["svc-a"],
    deviceDeployments: ["svc-a"],
    serviceInstances: ["sha256-a", "sha256-b"],
    sessions: ["sha256-a", "sha256-b"],
    approvals: ["sha256-a", "sha256-b"],
  });
  assertEquals(deleted, ["sha256-b"]);
});
