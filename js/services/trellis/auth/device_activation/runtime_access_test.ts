import { assertEquals, assertThrows } from "@std/assert";

import type { ContractRecord } from "../../state/schemas.ts";

import {
  deriveDeviceRuntimeAccess,
  resolveDeviceContractDigest,
} from "./runtime_access.ts";

const PROFILE = {
  profileId: "reader.default",
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
        streams: [],
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
  assertThrows(
    () => resolveDeviceContractDigest(PROFILE, undefined),
    Error,
    "invalid_auth_token",
  );
});

Deno.test("resolveDeviceContractDigest keeps explicit allowed device digests", () => {
  assertEquals(resolveDeviceContractDigest(PROFILE, "digest-b"), "digest-b");
});

Deno.test("resolveDeviceContractDigest rejects digests outside the allowed active set", () => {
  assertThrows(
    () => resolveDeviceContractDigest(PROFILE, "digest-c"),
    Error,
    "device_digest_not_allowed",
  );
});

Deno.test("deriveDeviceRuntimeAccess preserves the caller-selected digest", () => {
  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeContractRecord("digest-b"),
  );

  assertEquals(access.contractDigest, "digest-b");
  assertEquals(access.contractId, "acme.reader@v1");
  assertEquals(access.capabilities, ["reader.call"]);
});

Deno.test("deriveDeviceRuntimeAccess includes publish subjects from contract uses", () => {
  const fakeContractStore = {
    findActiveDigestById(contractId: string) {
      if (contractId === "trellis.auth@v1") return "auth-digest";
      if (contractId === "billing@v1") return "billing-digest";
      return null;
    },
    getContract(digest: string) {
      if (digest === "auth-digest") {
        return {
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
        };
      }
      if (digest === "billing-digest") {
        return {
          id: "billing@v1",
          displayName: "Billing",
          description: "Billing API",
          operations: {
            "Billing.Refund": {
              subject: "operations.v1.Billing.Refund",
              version: "v1",
              capabilities: { call: ["billing.refund"] },
              input: { schema: "object" },
              output: { schema: "object" },
            },
          },
        };
      }
      return null;
    },
  };

  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeUsesContractRecord(),
    fakeContractStore as never,
  );

  assertEquals(access.publishSubjects.includes("rpc.v1.Auth.Me"), true);
  assertEquals(
    access.publishSubjects.includes("operations.v1.Billing.Refund"),
    true,
  );
  assertEquals(
    access.publishSubjects.includes("operations.v1.Billing.Refund.control"),
    true,
  );
  assertEquals(access.capabilities.includes("billing.refund"), true);
});
