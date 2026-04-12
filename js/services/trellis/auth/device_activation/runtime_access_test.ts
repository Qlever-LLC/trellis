import { assertEquals, assertThrows } from "@std/assert";

import type { ContractRecord } from "../../state/schemas.ts";

import {
  deriveDeviceRuntimeAccess,
  resolveDeviceContractDigest,
} from "./runtime_access.ts";

const PROFILE = {
  profileId: "reader.default",
  contractId: "acme.reader@v1",
  allowedDigests: ["digest-a", "digest-b", "digest-uses"],
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
  const access = deriveDeviceRuntimeAccess(PROFILE, makeContractRecord("digest-b"));

  assertEquals(access.contractDigest, "digest-b");
  assertEquals(access.contractId, PROFILE.contractId);
  assertEquals(access.capabilities, ["reader.call"]);
});

Deno.test("deriveDeviceRuntimeAccess includes publish subjects from contract uses", () => {
  const fakeContractStore = {
    findActiveDigestById(contractId: string) {
      return contractId === "trellis.auth@v1" ? "auth-digest" : null;
    },
    getContract(digest: string) {
      if (digest !== "auth-digest") return null;
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
    },
  };

  const access = deriveDeviceRuntimeAccess(
    PROFILE,
    makeUsesContractRecord(),
    fakeContractStore as never,
  );

  assertEquals(access.publishSubjects.includes("rpc.v1.Auth.Me"), true);
});
