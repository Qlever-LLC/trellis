import { assertEquals } from "@std/assert";

import type { ContractRecord } from "../../catalog/schemas.ts";

import {
  deriveDeviceRuntimeAccess,
  resolveDeviceContractDigest,
} from "./runtime_access.ts";

const PROFILE = {
  deploymentId: "reader.default",
  appliedContracts: [{
    contractId: "acme.reader@v1",
    allowedDigests: ["digest-a", "digest-b", "digest-uses"],
  }],
  disabled: false,
};

function makeContractRecord(digest: string): ContractRecord {
  return {
    digest,
    id: "acme.reader@v1",
    displayName: "Reader",
    description: "Reader device contract",
    installedAt: new Date(),
    contract: JSON.stringify({ id: "acme.reader@v1" }),
    analysis: {
      namespaces: [],
      rpc: {
        methods: [{
          key: "Reader.Ping",
          subject: "rpc.v1.Reader.Ping",
          wildcardSubject: "rpc.v1.Reader.Ping",
          callerCapabilities: ["reader.call"],
        }],
      },
      operations: {
        operations: [],
        control: [],
      },
      events: {
        events: [],
      },
      nats: {
        publish: [{
          kind: "rpc",
          subject: "rpc.v1.Reader.Ping",
          wildcardSubject: "rpc.v1.Reader.Ping",
          requiredCapabilities: ["reader.call"],
        }],
        subscribe: [{
          kind: "rpc",
          subject: "rpc.v1.Reader.Ping",
          wildcardSubject: "rpc.v1.Reader.Ping",
          requiredCapabilities: ["reader.call"],
        }],
      },
      resources: {
        kv: [],
        store: [],
        jobs: [],
      },
    },
  };
}

function makeUsesContractRecord(): ContractRecord {
  return {
    ...makeContractRecord("digest-uses"),
    digest: "digest-uses",
    contract: JSON.stringify({
      id: "acme.reader@v1",
      displayName: "Reader",
      description: "Reader device contract",
      kind: "device",
      uses: {
        auth: {
          contract: "trellis.auth@v1",
          rpc: { call: ["Auth.Me"] },
        },
        billing: {
          contract: "billing@v1",
          operations: { call: ["Billing.Refund"] },
        },
      },
    }),
  };
}

Deno.test("resolveDeviceContractDigest rejects missing device contract digests", () => {
  assertEquals(resolveDeviceContractDigest(PROFILE, undefined), {
    ok: false,
    reason: "invalid_auth_token",
  });
});

Deno.test("resolveDeviceContractDigest keeps explicit allowed device digests", () => {
  assertEquals(resolveDeviceContractDigest(PROFILE, "digest-b"), {
    ok: true,
    value: "digest-b",
  });
});

Deno.test("resolveDeviceContractDigest rejects digests outside the allowed active set", () => {
  assertEquals(resolveDeviceContractDigest(PROFILE, "digest-c"), {
    ok: false,
    reason: "device_digest_not_allowed",
  });
});

Deno.test("deriveDeviceRuntimeAccess preserves the caller-selected digest", () => {
  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeContractRecord("digest-b"),
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(access.value.contractDigest, "digest-b");
  assertEquals(access.value.contractId, "acme.reader@v1");
  assertEquals(access.value.capabilities, ["reader.call"]);
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.upload.*.*"),
    false,
  );
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
  assertEquals(
    access.value.subscribeSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
});

Deno.test("deriveDeviceRuntimeAccess includes publish subjects from contract uses", () => {
  const fakeContractStore = {
    getActiveContractsById(contractId: string) {
      if (contractId === "trellis.auth@v1") {
        return [{
          id: "trellis.auth@v1",
          displayName: "Auth",
          description: "Auth API",
          rpc: {
            "Auth.Me": {
              subject: "rpc.v1.Auth.Me",
              version: "v1",
              transfer: { direction: "receive" },
              capabilities: { call: [] },
              request: { schema: "object" },
              response: { schema: "object" },
            },
          },
        }];
      }
      if (contractId === "billing@v1") {
        return [{
          id: "billing@v1",
          displayName: "Billing",
          description: "Billing API",
          operations: {
            "Billing.Refund": {
              subject: "operations.v1.Billing.Refund",
              version: "v1",
              transfer: {
                direction: "send",
                store: "uploads",
                key: "/key",
              },
              capabilities: { call: ["billing.refund"] },
              input: { schema: "object" },
              output: { schema: "object" },
            },
          },
        }];
      }
      return [];
    },
  };

  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeUsesContractRecord(),
    fakeContractStore as never,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(access.value.publishSubjects.includes("rpc.v1.Auth.Me"), true);
  assertEquals(
    access.value.publishSubjects.includes("operations.v1.Billing.Refund"),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    false,
  );
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.upload.*.*"),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
  assertEquals(
    access.value.subscribeSubjects.includes("transfer.v1.download.*.*"),
    true,
  );
  assertEquals(access.value.capabilities.includes("billing.refund"), true);
});

Deno.test("deriveDeviceRuntimeAccess includes operation control when call capabilities satisfy read", () => {
  const fakeContractStore = {
    getActiveContractsById(contractId: string) {
      if (contractId === "trellis.auth@v1") {
        return [{
          id: "trellis.auth@v1",
          displayName: "Auth",
          description: "Auth API",
          rpc: {
            "Auth.Me": {
              subject: "rpc.v1.Auth.Me",
              version: "v1",
              capabilities: { call: [] },
              request: { schema: "object" },
              response: { schema: "object" },
            },
          },
        }];
      }
      if (contractId === "billing@v1") {
        return [{
          id: "billing@v1",
          displayName: "Billing",
          description: "Billing API",
          operations: {
            "Billing.Refund": {
              subject: "operations.v1.Billing.Refund",
              version: "v1",
              capabilities: {
                call: ["billing.refund"],
                read: ["billing.refund"],
              },
              input: { schema: "object" },
              output: { schema: "object" },
            },
          },
        }];
      }
      return [];
    },
  };

  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeUsesContractRecord(),
    fakeContractStore as never,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    true,
  );
});

Deno.test("deriveDeviceRuntimeAccess includes operation control when cancel is enabled and granted", () => {
  const fakeContractStore = {
    getActiveContractsById(contractId: string) {
      if (contractId === "trellis.auth@v1") {
        return [{
          id: "trellis.auth@v1",
          displayName: "Auth",
          description: "Auth API",
          rpc: {
            "Auth.Me": {
              subject: "rpc.v1.Auth.Me",
              version: "v1",
              capabilities: { call: [] },
              request: { schema: "object" },
              response: { schema: "object" },
            },
          },
        }];
      }
      if (contractId === "billing@v1") {
        return [{
          id: "billing@v1",
          displayName: "Billing",
          description: "Billing API",
          operations: {
            "Billing.Refund": {
              subject: "operations.v1.Billing.Refund",
              version: "v1",
              cancel: true,
              capabilities: {
                call: ["billing.cancel"],
                read: ["billing.read"],
                cancel: ["billing.cancel"],
              },
              input: { schema: "object" },
              output: { schema: "object" },
            },
          },
        }];
      }
      return [];
    },
  };

  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeUsesContractRecord(),
    fakeContractStore as never,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    true,
  );
});
