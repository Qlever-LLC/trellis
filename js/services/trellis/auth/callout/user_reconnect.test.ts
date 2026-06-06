import { assertEquals } from "@std/assert";

import type { UserProjectionEntry, UserSession } from "../schemas.ts";
import { resolveUserReconnectSession } from "./user_reconnect.ts";

function createSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    userId: "usr_123",
    identity: {
      identityId: "idn_github_123",
      provider: "github",
      subject: "123",
    },
    email: "user@example.com",
    name: "User",
    participantKind: "app",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:00:00.000Z"),
    contractDigest: "digest-approved",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    approvalSource: "stored_approval",
    delegatedCapabilities: ["audit"],
    delegatedPublishSubjects: ["trellis.console.audit.publish"],
    delegatedSubscribeSubjects: ["trellis.console.audit"],
    identityAuthorityNeeds: {
      contracts: [{ contractId: "trellis.audit@v1", required: true }],
      surfaces: [{
        contractId: "trellis.audit@v1",
        kind: "event",
        name: "Audit.Recorded",
        action: "subscribe",
        required: true,
      }],
      capabilities: ["audit"],
      resources: [],
    },
    ...overrides,
  };
}

function activeUser(
  overrides: Partial<UserProjectionEntry> = {},
): UserProjectionEntry {
  return {
    origin: "github",
    id: "123",
    name: "User",
    email: "user@example.com",
    active: true,
    capabilities: ["audit"],
    capabilityGroups: [],
    ...overrides,
  };
}

Deno.test("resolveUserReconnectSession preserves stored delegated subjects without contract replanning", async () => {
  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: "digest-approved",
    loadUserProjection: async () => activeUser(),
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.session.contractDigest, "digest-approved");
  assertEquals(result.session.delegatedCapabilities, ["audit"]);
  assertEquals(result.session.delegatedPublishSubjects, [
    "trellis.console.audit.publish",
  ]);
  assertEquals(result.session.delegatedSubscribeSubjects, [
    "trellis.console.audit",
  ]);
});

Deno.test("resolveUserReconnectSession denies subjects outside stored delegated grants even if current contracts would allow them", async () => {
  const result = await resolveUserReconnectSession({
    session: createSession({
      delegatedPublishSubjects: ["trellis.console.audit.publish"],
    }),
    presentedContractDigest: "digest-approved",
    loadUserProjection: async () =>
      activeUser({ capabilities: ["audit", "catalog.read"] }),
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    result.session.delegatedPublishSubjects.includes(
      "trellis.console.catalog.ready",
    ),
    false,
  );
});

Deno.test("resolveUserReconnectSession rejects changed digest and missing current capabilities", async () => {
  assertEquals(
    await resolveUserReconnectSession({
      session: createSession(),
      presentedContractDigest: "digest-current-contract",
      loadUserProjection: async () => activeUser(),
    }),
    { ok: false, reason: "contract_changed" },
  );

  assertEquals(
    await resolveUserReconnectSession({
      session: createSession(),
      presentedContractDigest: "digest-approved",
      loadUserProjection: async () => activeUser({ capabilities: [] }),
    }),
    { ok: false, reason: "insufficient_permissions" },
  );
});

Deno.test("resolveUserReconnectSession returns user state failures", async () => {
  assertEquals(
    await resolveUserReconnectSession({
      session: createSession(),
      presentedContractDigest: "digest-approved",
      loadUserProjection: async () => activeUser({ active: false }),
    }),
    { ok: false, reason: "user_inactive" },
  );

  assertEquals(
    await resolveUserReconnectSession({
      session: createSession(),
      presentedContractDigest: "digest-approved",
      loadUserProjection: async () => null,
    }),
    { ok: false, reason: "user_not_found" },
  );
});
