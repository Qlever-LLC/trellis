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

Deno.test("contract analysis includes operation subjects and control metadata", () => {
  const contract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "billing@v1",
    displayName: "Billing",
    description: "Billing test contract",
    kind: "service",
    schemas: {
      Input: { type: "object" },
      Progress: { type: "object" },
      Output: { type: "object" },
    },
    operations: {
      Refund: {
        version: "v1",
        subject: "operations.v1.Billing.Refund",
        input: { schema: "Input" },
        progress: { schema: "Progress" },
        output: { schema: "Output" },
        capabilities: {
          call: ["billing.refund"],
          read: ["billing.refund.read"],
          cancel: ["billing.refund.cancel"],
        },
        cancel: true,
      },
    },
  };

  const analyzed = analyzeContract(contract);

  assertEquals(analyzed.summary.operations, 1);
  assertEquals(analyzed.summary.operationControls, 4);
  assertEquals(analyzed.summary.namespaces, ["Billing"]);
  assertEquals(analyzed.analysis.operations.operations, [{
    key: "Refund",
    subject: "operations.v1.Billing.Refund",
    wildcardSubject: "operations.v1.Billing.Refund",
    controlSubject: "operations.v1.Billing.Refund.control",
    wildcardControlSubject: "operations.v1.Billing.Refund.control",
    callCapabilities: ["billing.refund"],
    readCapabilities: ["billing.refund.read"],
    cancelCapabilities: ["billing.refund.cancel"],
    cancel: true,
  }]);
  assertEquals(
    analyzed.analysis.operations.control.map((control) => ({
      action: control.action,
      requiredCapabilities: control.requiredCapabilities,
    })),
    [
      { action: "cancel", requiredCapabilities: ["billing.refund.cancel"] },
      { action: "get", requiredCapabilities: ["billing.refund.read"] },
      { action: "wait", requiredCapabilities: ["billing.refund.read"] },
      { action: "watch", requiredCapabilities: ["billing.refund.read"] },
    ],
  );
  assertEquals(analyzed.analysis.nats.publish, [{
    kind: "operation:call",
    subject: "operations.v1.Billing.Refund",
    wildcardSubject: "operations.v1.Billing.Refund",
    requiredCapabilities: ["billing.refund"],
  }]);
  assertEquals(analyzed.analysis.nats.subscribe, [
    {
      kind: "operation:handle",
      subject: "operations.v1.Billing.Refund",
      wildcardSubject: "operations.v1.Billing.Refund",
      requiredCapabilities: ["service"],
    },
    {
      kind: "operation:control",
      subject: "operations.v1.Billing.Refund.control",
      wildcardSubject: "operations.v1.Billing.Refund.control",
      requiredCapabilities: ["service"],
    },
  ]);
});
