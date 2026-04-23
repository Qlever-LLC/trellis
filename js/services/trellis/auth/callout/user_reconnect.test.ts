import { assertEquals } from "@std/assert";

import type { ContractApprovalRecord, UserSession } from "../../state/schemas.ts";
import { ContractStore } from "../../catalog/store.ts";
import { resolveUserReconnectSession } from "./user_reconnect.ts";

async function activateContract(
  store: ContractStore,
  contract: Record<string, unknown>,
): Promise<string> {
  const validated = await store.validate(contract);
  store.activate(validated.digest, validated.contract);
  return validated.digest;
}

function createSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    trellisId: "tid_123",
    origin: "github",
    id: "123",
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
    appOrigin: "https://app.example.com",
    approvalSource: "stored_approval",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: ["rpc.v1.Auth.Old"],
    delegatedSubscribeSubjects: ["events.v1.Auth.Old"],
    ...overrides,
  };
}

function createStoredApproval(digest: string): ContractApprovalRecord {
  return {
    userTrellisId: "tid_123",
    origin: "github",
    id: "123",
    answer: "approved",
    answeredAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    approval: {
      contractDigest: digest,
      contractId: "trellis.console@v1",
      displayName: "Console",
      description: "Admin app",
      participantKind: "app",
      capabilities: ["audit"],
    },
    publishSubjects: [],
    subscribeSubjects: [],
  };
}

Deno.test("resolveUserReconnectSession refreshes delegated envelope from the presented digest", async () => {
  const store = new ContractStore();
  const digest = await activateContract(store, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
    subjects: {
      audit: {
        subject: "trellis.console.audit",
        capabilities: { publish: ["audit"] },
      },
    },
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contractStore: store,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
    }),
    loadStoredApproval: async () => null,
    loadInstanceGrantPolicies: async () => [{
      contractId: "trellis.console@v1",
      impliedCapabilities: ["audit"],
      allowedOrigins: ["https://app.example.com"],
      disabled: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      source: { kind: "admin_policy" },
    }],
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.session.contractDigest, digest);
  assertEquals(result.session.approvalSource, "admin_policy");
  assertEquals(result.session.delegatedCapabilities, ["audit"]);
  assertEquals(result.session.delegatedPublishSubjects, ["trellis.console.audit"]);
  assertEquals(result.session.delegatedSubscribeSubjects, ["trellis.console.audit"]);
});

Deno.test("resolveUserReconnectSession returns approval_required when current approval no longer applies", async () => {
  const store = new ContractStore();
  const digest = await activateContract(store, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
    subjects: {
      audit: {
        subject: "trellis.console.audit",
        capabilities: { publish: ["audit"] },
      },
    },
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contractStore: store,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
    }),
    loadStoredApproval: async () => null,
    loadInstanceGrantPolicies: async () => [],
  });

  assertEquals(result, { ok: false, reason: "approval_required" });
});

Deno.test("resolveUserReconnectSession returns contract_changed for an inactive or wrong app digest", async () => {
  const store = new ContractStore();
  const validated = await store.validate({
    format: "trellis.contract.v1",
    id: "trellis.other@v1",
    displayName: "Other",
    description: "Other app",
    kind: "app",
  });
  store.add(validated.digest, validated.contract);

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: validated.digest,
    contractStore: store,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: ["admin"],
    }),
    loadStoredApproval: async () => createStoredApproval(validated.digest),
    loadInstanceGrantPolicies: async () => [],
  });

  assertEquals(result, { ok: false, reason: "contract_changed" });
});

Deno.test("resolveUserReconnectSession returns user_inactive for inactive users", async () => {
  const store = new ContractStore();
  const digest = await activateContract(store, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contractStore: store,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: false,
      capabilities: ["admin"],
    }),
    loadStoredApproval: async () => createStoredApproval(digest),
    loadInstanceGrantPolicies: async () => [],
  });

  assertEquals(result, { ok: false, reason: "user_inactive" });
});

Deno.test("resolveUserReconnectSession returns user_not_found when the bound user no longer exists", async () => {
  const store = new ContractStore();
  const digest = await activateContract(store, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contractStore: store,
    loadUserProjection: async () => null,
    loadStoredApproval: async () => createStoredApproval(digest),
    loadInstanceGrantPolicies: async () => [],
  });

  assertEquals(result, { ok: false, reason: "user_not_found" });
});

Deno.test("resolveUserReconnectSession returns insufficient_permissions when approval remains but capabilities no longer do", async () => {
  const store = new ContractStore();
  const digest = await activateContract(store, {
    format: "trellis.contract.v1",
    id: "trellis.console@v1",
    displayName: "Console",
    description: "Admin app",
    kind: "app",
    subjects: {
      audit: {
        subject: "trellis.console.audit",
        capabilities: { publish: ["audit"] },
      },
    },
  });

  const result = await resolveUserReconnectSession({
    session: createSession(),
    presentedContractDigest: digest,
    contractStore: store,
    loadUserProjection: async () => ({
      origin: "github",
      id: "123",
      name: "User",
      email: "user@example.com",
      active: true,
      capabilities: [],
    }),
    loadStoredApproval: async () => createStoredApproval(digest),
    loadInstanceGrantPolicies: async () => [],
  });

  assertEquals(result, { ok: false, reason: "insufficient_permissions" });
});
