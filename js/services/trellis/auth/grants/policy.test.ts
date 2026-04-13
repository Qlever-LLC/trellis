import { assertEquals } from "@std/assert";

import {
  matchingInstanceGrantPolicies,
  userDelegationAllowed,
} from "./policy.ts";

Deno.test("matching policy allows delegated access even when stored approval is denied", () => {
  const policies = matchingInstanceGrantPolicies({
    policies: [{
      contractId: "trellis.console@v1",
      allowedOrigins: ["https://console.example.com"],
      impliedCapabilities: ["admin"],
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: { kind: "admin_policy" },
    }],
    contractId: "trellis.console@v1",
    appOrigin: "https://console.example.com",
  });

  assertEquals(userDelegationAllowed({
    active: true,
    explicitCapabilities: [],
    delegatedCapabilities: ["admin"],
    storedApproval: {
      userTrellisId: "tid",
      origin: "github",
      id: "123",
      answer: "denied",
      answeredAt: new Date(),
      updatedAt: new Date(),
      approval: {
        contractDigest: "digest",
        contractId: "trellis.console@v1",
        displayName: "Console",
        description: "Admin",
        kind: "app",
        capabilities: ["admin"],
      },
      publishSubjects: [],
      subscribeSubjects: [],
    },
    matchedPolicies: policies,
  }), true);
});

Deno.test("origin mismatch falls back to stored approval behavior", () => {
  const policies = matchingInstanceGrantPolicies({
    policies: [{
      contractId: "trellis.console@v1",
      allowedOrigins: ["https://console.example.com"],
      impliedCapabilities: ["admin"],
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: { kind: "admin_policy" },
    }],
    contractId: "trellis.console@v1",
    appOrigin: "https://different.example.com",
  });

  assertEquals(userDelegationAllowed({
    active: true,
    explicitCapabilities: [],
    delegatedCapabilities: ["admin"],
    storedApproval: {
      userTrellisId: "tid",
      origin: "github",
      id: "123",
      answer: "denied",
      answeredAt: new Date(),
      updatedAt: new Date(),
      approval: {
        contractDigest: "digest",
        contractId: "trellis.console@v1",
        displayName: "Console",
        description: "Admin",
        kind: "app",
        capabilities: ["admin"],
      },
      publishSubjects: [],
      subscribeSubjects: [],
    },
    matchedPolicies: policies,
  }), false);
});

Deno.test("stored approval remains valid when no policy matches", () => {
  assertEquals(userDelegationAllowed({
    active: true,
    explicitCapabilities: ["admin"],
    delegatedCapabilities: ["admin"],
    storedApproval: {
      userTrellisId: "tid",
      origin: "github",
      id: "123",
      answer: "approved",
      answeredAt: new Date(),
      updatedAt: new Date(),
      approval: {
        contractDigest: "digest",
        contractId: "trellis.console@v1",
        displayName: "Console",
        description: "Admin",
        kind: "app",
        capabilities: ["admin"],
      },
      publishSubjects: [],
      subscribeSubjects: [],
    },
    matchedPolicies: [],
  }), true);
});
