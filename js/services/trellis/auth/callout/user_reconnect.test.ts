import { assertEquals } from "@std/assert";

import type { EnvelopeBoundary, UserSession } from "../schemas.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import { resolveUserReconnectSession } from "./user_reconnect.ts";

type TestContracts = ReturnType<typeof createTestContracts>;

async function activateContract(
  contracts: TestContracts,
  contract: Record<string, unknown>,
): Promise<string> {
  const validated = await contracts.validateContract(contract);
  contracts.activateTestContract(validated);
  return validated.digest;
}

async function addKnownContract(
  contracts: TestContracts,
  contract: Record<string, unknown>,
): Promise<string> {
  const validated = await contracts.validateContract(contract);
  contracts.addKnownTestContract(validated);
  return validated.digest;
}

async function activateAuditDependency(
  contracts: TestContracts,
): Promise<void> {
  await activateContract(contracts, {
    format: "trellis.contract.v1",
    id: "trellis.audit@v1",
    displayName: "Audit",
    description: "Audit events",
    kind: "service",
    schemas: { AuditEvent: { type: "object" } },
    events: {
      "Audit.Recorded": {
        version: "v1",
        subject: "trellis.console.audit",
        event: { schema: "AuditEvent" },
        capabilities: { subscribe: ["audit"] },
      },
    },
  });
}

function consoleAppContract(): Record<string, unknown> {
  return {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
    schemas: { AuditEvent: { type: "object" } },
    events: {
      "Audit.Recorded": {
        version: "v1",
        subject: "trellis.console.audit.publish",
        event: { schema: "AuditEvent" },
        capabilities: { publish: ["audit"] },
      },
    },
    uses: {
      required: {
        audit: {
          contract: "trellis.audit@v1",
          events: { subscribe: ["Audit.Recorded"] },
        },
      },
    },
  };
}

function coreCatalogAppContract(): Record<string, unknown> {
  return {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
    schemas: { CatalogEvent: { type: "object" } },
    events: {
      "Catalog.Ready": {
        version: "v1",
        subject: "trellis.console.catalog.ready",
        event: { schema: "CatalogEvent" },
        capabilities: { publish: ["trellis.core::catalog.read"] },
      },
    },
  };
}

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
    contractDigest: "digest-old",
    contractId: "trellis.console@v1",
    contractDisplayName: "Old Console",
    contractDescription: "Old app",
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    approvalSource: "stored_approval",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: ["rpc.v1.Auth.Old"],
    delegatedSubscribeSubjects: ["events.v1.Auth.Old"],
    ...overrides,
  };
}

function consoleIdentityEnvelope(): EnvelopeBoundary {
  return {
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
  };
}

Deno.test("resolveUserReconnectSession refreshes delegated envelope from the presented digest", async () => {
  const contracts = createTestContracts();
  await activateAuditDependency(contracts);
  const digest = await activateContract(contracts, consoleAppContract());

  const result = await resolveUserReconnectSession({
    session: createSession({ identityEnvelope: consoleIdentityEnvelope() }),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: ["audit"],
      capabilityGroups: [],
    }),
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.session.contractDigest, digest);
  assertEquals(result.session.approvalSource, "stored_approval");
  assertEquals(result.session.delegatedCapabilities, ["audit"]);
  assertEquals(result.session.delegatedPublishSubjects, [
    "trellis.console.audit.publish",
  ]);
  assertEquals(result.session.delegatedSubscribeSubjects, [
    "trellis.console.audit",
  ]);
});

Deno.test("resolveUserReconnectSession accepts a known app digest that is not active", async () => {
  const contracts = createTestContracts();
  await activateAuditDependency(contracts);
  const digest = await addKnownContract(contracts, consoleAppContract());

  const result = await resolveUserReconnectSession({
    session: createSession({ identityEnvelope: consoleIdentityEnvelope() }),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: ["audit"],
      capabilityGroups: [],
    }),
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.session.contractDigest, digest);
  assertEquals(await contracts.getContract(digest), undefined);
});

Deno.test("resolveUserReconnectSession resolves direct admin for generated core capabilities", async () => {
  const contracts = createTestContracts();
  const digest = await activateContract(contracts, coreCatalogAppContract());

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "account",
      id: "usr_123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: ["admin"],
      capabilityGroups: [],
    }),
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.session.delegatedCapabilities, [
    "trellis.core::catalog.read",
  ]);
  assertEquals(result.session.delegatedPublishSubjects, [
    "trellis.console.catalog.ready",
  ]);
});

Deno.test("resolveUserReconnectSession returns approval_required when current approval no longer applies", async () => {
  const contracts = createTestContracts();
  await activateAuditDependency(contracts);
  const digest = await activateContract(contracts, consoleAppContract());

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
  });

  assertEquals(result, { ok: false, reason: "approval_required" });
});

Deno.test("resolveUserReconnectSession returns contract_changed for an inactive or wrong app digest", async () => {
  const contracts = createTestContracts();
  const validated = await contracts.validateContract({
    format: "trellis.contract.v1",
    id: "trellis.other@v1",
    displayName: "Other",
    description: "Other app",
    kind: "app",
  });
  contracts.addKnownTestContract(validated);

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: validated.digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: ["admin"],
      capabilityGroups: [],
    }),
  });

  assertEquals(result, { ok: false, reason: "contract_changed" });
});

Deno.test("resolveUserReconnectSession returns user_inactive for inactive users", async () => {
  const contracts = createTestContracts();
  const digest = await activateContract(contracts, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: false,
      capabilities: ["admin"],
      capabilityGroups: [],
    }),
  });

  assertEquals(result, { ok: false, reason: "user_inactive" });
});

Deno.test("resolveUserReconnectSession returns user_not_found when the bound user no longer exists", async () => {
  const contracts = createTestContracts();
  const digest = await activateContract(contracts, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => null,
  });

  assertEquals(result, { ok: false, reason: "user_not_found" });
});

Deno.test("resolveUserReconnectSession returns insufficient_permissions when approval remains but capabilities no longer do", async () => {
  const contracts = createTestContracts();
  await activateAuditDependency(contracts);
  const digest = await activateContract(contracts, consoleAppContract());

  const result = await resolveUserReconnectSession({
    session: createSession({ identityEnvelope: consoleIdentityEnvelope() }),
    presentedContractDigest: digest,
    contracts,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
    }),
  });

  assertEquals(result, { ok: false, reason: "insufficient_permissions" });
});
