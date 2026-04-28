import { assertEquals, assertInstanceOf, assertMatch } from "@std/assert";
import { eq } from "drizzle-orm";
import type { StaticDecode } from "typebox";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { TrellisStorage } from "../storage/db.ts";
import {
  contractApprovals,
  deviceActivationReviews,
  deviceActivations,
  deviceDeployments,
  deviceInstances,
  devicePortalSelections,
  deviceProvisioningSecrets,
  instanceGrantPolicies,
  loginPortalSelections,
  portalDefaults,
  portalProfiles,
  portals,
  serviceDeployments,
  serviceInstances,
  sessions,
  users as usersTable,
} from "../storage/schema.ts";
import type {
  ContractApprovalRecord,
  DeviceSession,
  ServiceSession,
  Session,
  UserProjectionEntry,
  UserSession,
} from "./schemas.ts";
import {
  DeviceActivationRecordSchema,
  DeviceActivationReviewRecordSchema,
  DeviceDeploymentSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceProvisioningSecretSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  PortalProfileSchema,
  PortalSchema,
  ServiceDeploymentSchema,
  ServiceInstanceSchema,
} from "./schemas.ts";
import {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlInstanceGrantPolicyRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

type Portal = StaticDecode<typeof PortalSchema>;
type PortalProfile = StaticDecode<typeof PortalProfileSchema>;
type LoginPortalDefault = StaticDecode<typeof LoginPortalDefaultSchema>;
type DevicePortalDefault = StaticDecode<typeof DevicePortalDefaultSchema>;
type LoginPortalSelection = StaticDecode<typeof LoginPortalSelectionSchema>;
type DevicePortalSelection = StaticDecode<typeof DevicePortalSelectionSchema>;
type InstanceGrantPolicy = StaticDecode<typeof InstanceGrantPolicySchema>;
type ServiceDeployment = StaticDecode<typeof ServiceDeploymentSchema>;
type ServiceInstance = StaticDecode<typeof ServiceInstanceSchema>;
type DeviceDeployment = StaticDecode<typeof DeviceDeploymentSchema>;
type DeviceInstance = StaticDecode<typeof DeviceSchema>;
type DeviceProvisioningSecret = StaticDecode<
  typeof DeviceProvisioningSecretSchema
>;
type DeviceActivation = StaticDecode<typeof DeviceActivationRecordSchema>;
type DeviceActivationReviewRecord = StaticDecode<
  typeof DeviceActivationReviewRecordSchema
>;

async function withRepositories(
  test: (
    repos: {
      users: SqlUserProjectionRepository;
      approvals: SqlContractApprovalRepository;
      portals: SqlPortalRepository;
      portalProfiles: SqlPortalProfileRepository;
      portalDefaults: SqlPortalDefaultRepository;
      loginSelections: SqlLoginPortalSelectionRepository;
      deviceSelections: SqlDevicePortalSelectionRepository;
      policies: SqlInstanceGrantPolicyRepository;
      serviceDeployments: SqlServiceDeploymentRepository;
      serviceInstances: SqlServiceInstanceRepository;
      deviceDeployments: SqlDeviceDeploymentRepository;
      deviceInstances: SqlDeviceInstanceRepository;
      deviceProvisioningSecrets: SqlDeviceProvisioningSecretRepository;
      deviceActivations: SqlDeviceActivationRepository;
      deviceActivationReviews: SqlDeviceActivationReviewRepository;
      sessions: SqlSessionRepository;
    },
    storage: TrellisStorage,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-auth-storage-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    await test({
      users: new SqlUserProjectionRepository(storage.db),
      approvals: new SqlContractApprovalRepository(storage.db),
      portals: new SqlPortalRepository(storage.db),
      portalProfiles: new SqlPortalProfileRepository(storage.db),
      portalDefaults: new SqlPortalDefaultRepository(storage.db),
      loginSelections: new SqlLoginPortalSelectionRepository(storage.db),
      deviceSelections: new SqlDevicePortalSelectionRepository(storage.db),
      policies: new SqlInstanceGrantPolicyRepository(storage.db),
      serviceDeployments: new SqlServiceDeploymentRepository(storage.db),
      serviceInstances: new SqlServiceInstanceRepository(storage.db),
      deviceDeployments: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstances: new SqlDeviceInstanceRepository(storage.db),
      deviceProvisioningSecrets: new SqlDeviceProvisioningSecretRepository(
        storage.db,
      ),
      deviceActivations: new SqlDeviceActivationRepository(storage.db),
      deviceActivationReviews: new SqlDeviceActivationReviewRepository(
        storage.db,
      ),
      sessions: new SqlSessionRepository(storage.db),
    }, storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makePortal(overrides: Partial<Portal> = {}): Portal {
  return {
    portalId: "portal-a",
    entryUrl: "https://portal.example.com/login",
    disabled: false,
    ...overrides,
  };
}

function makePortalProfile(
  overrides: Partial<PortalProfile> = {},
): PortalProfile {
  return {
    portalId: "portal-a",
    entryUrl: "https://portal.example.com/login",
    contractId: "app@v1",
    allowedOrigins: ["https://app.example.com"],
    impliedCapabilities: ["items.read"],
    disabled: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:01.000Z",
    ...overrides,
  };
}

function makePolicy(
  overrides: Partial<InstanceGrantPolicy> = {},
): InstanceGrantPolicy {
  return {
    contractId: "app@v1",
    allowedOrigins: ["https://app.example.com"],
    impliedCapabilities: ["items.read"],
    disabled: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:01.000Z",
    source: {
      kind: "admin_policy",
      createdBy: { origin: "github", id: "admin" },
      updatedBy: { origin: "github", id: "admin" },
    },
    ...overrides,
  };
}

function makeServiceDeployment(
  overrides: Partial<ServiceDeployment> = {},
): ServiceDeployment {
  return {
    deploymentId: "svc-deployment-a",
    namespaces: ["graph", "search"],
    disabled: false,
    appliedContracts: [{
      contractId: "svc.graph@v1",
      allowedDigests: ["sha256-service-a"],
    }],
    ...overrides,
  };
}

function makeServiceInstance(
  overrides: Partial<ServiceInstance> = {},
): ServiceInstance {
  return {
    instanceId: "svc_instance_a",
    deploymentId: "svc-deployment-a",
    instanceKey: "session-key-a",
    disabled: false,
    currentContractId: "svc.graph@v1",
    currentContractDigest: "sha256-service-a",
    capabilities: ["service", "graph.query"],
    resourceBindings: {
      kv: {
        cache: { bucket: "graph-cache", history: 1, ttlMs: 0 },
      },
    },
    createdAt: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeviceDeployment(
  overrides: Partial<DeviceDeployment> = {},
): DeviceDeployment {
  return {
    deploymentId: "dev-deployment-a",
    reviewMode: "required",
    disabled: false,
    appliedContracts: [{
      contractId: "device.reader@v1",
      allowedDigests: ["sha256-device-a"],
    }],
    ...overrides,
  };
}

function makeDeviceInstance(
  overrides: Partial<DeviceInstance> = {},
): DeviceInstance {
  return {
    instanceId: "dev_instance_a",
    publicIdentityKey: "pub_identity_a",
    deploymentId: "dev-deployment-a",
    metadata: { label: "Kitchen display" },
    state: "registered",
    createdAt: "2026-04-26T00:00:00.000Z",
    activatedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function makeDeviceProvisioningSecret(
  overrides: Partial<DeviceProvisioningSecret> = {},
): DeviceProvisioningSecret {
  return {
    instanceId: "dev_instance_a",
    activationKey: "activation-key-a",
    createdAt: new Date("2026-04-26T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDeviceActivation(
  overrides: Partial<DeviceActivation> = {},
): DeviceActivation {
  return {
    instanceId: "dev_instance_a",
    publicIdentityKey: "pub_identity_a",
    deploymentId: "dev-deployment-a",
    activatedBy: { origin: "github", id: "admin" },
    state: "activated",
    activatedAt: "2026-04-26T00:00:01.000Z",
    revokedAt: null,
    ...overrides,
  };
}

function makeDeviceActivationReview(
  overrides: Partial<DeviceActivationReviewRecord> = {},
): DeviceActivationReviewRecord {
  return {
    reviewId: "dar_a",
    operationId: "op_activate_a",
    flowId: "flow_a",
    instanceId: "dev_instance_a",
    publicIdentityKey: "pub_identity_a",
    deploymentId: "dev-deployment-a",
    requestedBy: { origin: "github", id: "reviewer" },
    state: "pending",
    requestedAt: new Date("2026-04-26T00:00:00.000Z"),
    decidedAt: null,
    ...overrides,
  };
}

function makeUser(
  overrides: Partial<UserProjectionEntry> = {},
): UserProjectionEntry {
  return {
    origin: "github",
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    capabilities: ["catalog.read"],
    ...overrides,
  };
}

function makeApproval(
  overrides: Partial<ContractApprovalRecord> = {},
): ContractApprovalRecord {
  return {
    userTrellisId: "github.user-1",
    origin: "github",
    id: "user-1",
    answer: "approved",
    answeredAt: new Date("2026-04-26T00:00:00.000Z"),
    updatedAt: new Date("2026-04-26T00:00:01.000Z"),
    approval: {
      contractDigest: "sha256-contract-a",
      contractId: "app@v1",
      displayName: "Test App",
      description: "Test app contract",
      participantKind: "app",
      capabilities: ["items.read"],
    },
    publishSubjects: ["events.v1.Items.Updated"],
    subscribeSubjects: ["rpc.v1.Items.Get"],
    ...overrides,
  };
}

function makeUserSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    trellisId: "github.user-1",
    origin: "github",
    id: "user-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    participantKind: "app",
    contractDigest: "sha256-user-contract",
    contractId: "app@v1",
    contractDisplayName: "Test App",
    contractDescription: "Test app contract",
    delegatedCapabilities: ["items.read"],
    delegatedPublishSubjects: ["events.v1.Items.Updated"],
    delegatedSubscribeSubjects: ["rpc.v1.Items.Get"],
    createdAt: new Date("2026-04-26T00:00:00.000Z"),
    lastAuth: new Date("2026-04-26T00:00:01.000Z"),
    ...overrides,
  };
}

function makeServiceSession(
  overrides: Partial<ServiceSession> = {},
): ServiceSession {
  return {
    type: "service",
    trellisId: "svc_1",
    origin: "service",
    id: "billing",
    email: "billing@trellis.internal",
    name: "Billing",
    instanceId: "svc_1",
    deploymentId: "svc-deployment-a",
    instanceKey: "svc-session-key",
    currentContractId: "svc.graph@v1",
    currentContractDigest: "sha256-service-contract",
    createdAt: new Date("2026-04-26T00:00:00.000Z"),
    lastAuth: new Date("2026-04-26T00:00:01.000Z"),
    ...overrides,
  };
}

function makeDeviceSession(
  overrides: Partial<DeviceSession> = {},
): DeviceSession {
  return {
    type: "device",
    instanceId: "dev_1",
    publicIdentityKey: "public-identity-key-a",
    deploymentId: "dev-deployment-a",
    contractId: "device.reader@v1",
    contractDigest: "sha256-device-contract",
    delegatedCapabilities: ["device.sync"],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: ["rpc.v1.Device.Sync"],
    createdAt: new Date("2026-04-26T00:00:00.000Z"),
    lastAuth: new Date("2026-04-26T00:00:01.000Z"),
    activatedAt: new Date("2026-04-26T00:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

Deno.test("user storage upserts, gets, and lists projections", async () => {
  await withRepositories(async ({ users }, storage) => {
    const first = makeUser();
    await users.put("github.user-1", first);

    assertEquals(await users.get("github.user-1"), first);
    assertEquals(await users.get("missing"), undefined);

    const [row] = await storage.db.select().from(usersTable);
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.externalId, first.id);

    const updated = makeUser({
      name: undefined,
      email: "updated@example.com",
      active: false,
      capabilities: ["catalog.read", "catalog.write"],
    });
    await users.put("github.user-1", updated);

    const second = makeUser({
      origin: "oidc",
      id: "user-2",
      email: undefined,
      capabilities: [],
    });
    await users.put("oidc.user-2", second);

    assertEquals(await users.get("github.user-1"), updated);
    assertEquals(await users.list(), [updated, second]);
  });
});

Deno.test("approval storage upserts, gets, and preserves Date fields", async () => {
  await withRepositories(async ({ approvals }, storage) => {
    const first = makeApproval();
    await approvals.put(first);

    const stored = await approvals.get(
      first.userTrellisId,
      first.approval.contractDigest,
    );
    assertEquals(stored, first);
    assertInstanceOf(stored?.answeredAt, Date);
    assertInstanceOf(stored?.updatedAt, Date);

    const [row] = await storage.db.select().from(contractApprovals);
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.externalId, first.id);

    const updated = makeApproval({
      answer: "denied",
      answeredAt: new Date("2026-04-26T01:00:00.000Z"),
      updatedAt: new Date("2026-04-26T01:00:01.000Z"),
      publishSubjects: [],
      subscribeSubjects: [],
    });
    await approvals.put(updated);

    assertEquals(
      await approvals.get(
        updated.userTrellisId,
        updated.approval.contractDigest,
      ),
      updated,
    );
  });
});

Deno.test("approval storage lists by user, all approvals, and digest", async () => {
  await withRepositories(async ({ approvals }) => {
    const first = makeApproval({
      userTrellisId: "github.user-1",
      approval: {
        ...makeApproval().approval,
        contractDigest: "sha256-contract-a",
      },
    });
    const second = makeApproval({
      userTrellisId: "github.user-1",
      approval: {
        ...makeApproval().approval,
        contractDigest: "sha256-contract-b",
        contractId: "agent@v1",
        participantKind: "agent",
      },
    });
    const third = makeApproval({
      userTrellisId: "github.user-2",
      id: "user-2",
      approval: {
        ...makeApproval().approval,
        contractDigest: "sha256-contract-a",
      },
    });

    await approvals.put(second);
    await approvals.put(third);
    await approvals.put(first);

    assertEquals(await approvals.listByUser("github.user-1"), [first, second]);
    assertEquals(await approvals.list(), [first, second, third]);
    assertEquals(await approvals.listByDigest("sha256-contract-a"), [
      first,
      third,
    ]);
  });
});

Deno.test("approval storage deletes by user and digest", async () => {
  await withRepositories(async ({ approvals }) => {
    const first = makeApproval();
    const second = makeApproval({
      approval: {
        ...makeApproval().approval,
        contractDigest: "sha256-contract-b",
      },
    });
    await approvals.put(first);
    await approvals.put(second);

    await approvals.delete(first.userTrellisId, first.approval.contractDigest);

    assertEquals(
      await approvals.get(first.userTrellisId, first.approval.contractDigest),
      undefined,
    );
    assertEquals(await approvals.listByUser(first.userTrellisId), [second]);
  });
});

Deno.test("session storage upserts user, service, and device sessions", async () => {
  await withRepositories(async ({ sessions: sessionRepo }, storage) => {
    const user = makeUserSession();
    const service = makeServiceSession();
    const device = makeDeviceSession();
    await sessionRepo.put("user-session-key", user);
    await sessionRepo.put("service-session-key", service);
    await sessionRepo.put("device-session-key", device);

    const rows = await storage.db.select().from(sessions).orderBy(
      sessions.sessionKey,
    );
    assertEquals(rows.length, 3);
    for (const row of rows) {
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
    assertEquals(rows[0].sessionKey, "device-session-key");
    assertEquals(rows[0].trellisId, "dev_1");
    assertEquals(rows[0].origin, null);
    assertEquals(rows[0].externalId, null);
    assertEquals(rows[0].publicIdentityKey, "public-identity-key-a");
    assertEquals(rows[1].instanceKey, "svc-session-key");
    assertEquals(rows[2].participantKind, "app");

    assertEquals(
      await sessionRepo.getOneBySessionKey("user-session-key"),
      user,
    );
    assertInstanceOf(
      (await sessionRepo.getOneBySessionKey("user-session-key"))?.createdAt,
      Date,
    );
    assertEquals(
      await sessionRepo.getOneBySessionKey("service-session-key"),
      service,
    );
    assertEquals(
      await sessionRepo.getOneBySessionKey("device-session-key"),
      device,
    );
    assertEquals(await sessionRepo.getOneBySessionKey("missing"), undefined);

    const updated = makeUserSession({
      name: "Ada Updated",
      lastAuth: new Date("2026-04-26T00:00:02.000Z"),
      delegatedCapabilities: ["items.read", "items.write"],
    });
    await sessionRepo.put("user-session-key", updated);

    assertEquals(
      await sessionRepo.getOneBySessionKey("user-session-key"),
      updated,
    );
    assertEquals((await storage.db.select().from(sessions)).length, 3);
  });
});

Deno.test("session storage supports one-by-key and list filters", async () => {
  await withRepositories(async ({ sessions: sessionRepo }) => {
    const user = makeUserSession();
    const otherUser = makeUserSession({
      trellisId: "github.user-2",
      id: "user-2",
      contractDigest: "sha256-other-user-contract",
    });
    const service = makeServiceSession();
    const device = makeDeviceSession();
    await sessionRepo.put("user-session-key", user);
    await sessionRepo.put("other-user-session-key", otherUser);
    await sessionRepo.put("service-session-key", service);
    await sessionRepo.put("device-session-key", device);

    assertEquals(
      await sessionRepo.getOneBySessionKey("user-session-key"),
      user,
    );
    assertEquals(await sessionRepo.getOneBySessionKey("missing"), undefined);
    assertEquals(await sessionRepo.listByUser("github.user-1"), [user]);
    assertEquals(await sessionRepo.listByInstanceKey("svc-session-key"), [
      service,
    ]);
    assertEquals(await sessionRepo.listEntriesByUser("github.user-1"), [{
      sessionKey: "user-session-key",
      trellisId: "github.user-1",
      session: user,
    }]);
    assertEquals(
      await sessionRepo.listByContractDigest("sha256-user-contract"),
      [user],
    );
    assertEquals(
      await sessionRepo.listByContractDigest("sha256-device-contract"),
      [device],
    );
    assertEquals(await sessionRepo.list(), [
      device,
      otherUser,
      service,
      user,
    ]);
  });
});

Deno.test("session storage expires sessions from last auth when TTL is configured", async () => {
  await withRepositories(async (_, storage) => {
    const sessionRepo = new SqlSessionRepository(storage.db, {
      sessionTtlMs: 60_000,
      now: () => new Date("2026-04-26T00:10:00.000Z"),
    });
    const expired = makeUserSession({
      lastAuth: new Date("2026-04-26T00:08:59.999Z"),
    });
    const fresh = makeUserSession({
      trellisId: "github.user-2",
      id: "user-2",
      contractDigest: "sha256-other-user-contract",
      lastAuth: new Date("2026-04-26T00:09:30.000Z"),
    });

    await sessionRepo.put("expired-session-key", expired);
    await sessionRepo.put("fresh-session-key", fresh);

    assertEquals(
      await sessionRepo.getOneBySessionKey("expired-session-key"),
      undefined,
    );
    assertEquals(
      await sessionRepo.getOneBySessionKey("fresh-session-key"),
      fresh,
    );
    const rows = await storage.db.select().from(sessions);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].sessionKey, "fresh-session-key");
  });
});

Deno.test("session storage deletes by session key", async () => {
  await withRepositories(async ({ sessions: sessionRepo }) => {
    const first = makeUserSession();
    const second = makeUserSession({
      trellisId: "github.user-2",
      id: "user-2",
      contractDigest: "sha256-other-user-contract",
    });
    const service = makeServiceSession();
    await sessionRepo.put("first-session-key", first);
    await sessionRepo.put("second-session-key", second);
    await sessionRepo.put("service-session-key", service);

    assertEquals(
      await sessionRepo.getOneBySessionKey("first-session-key"),
      first,
    );

    await sessionRepo.deleteBySessionKey("first-session-key");
    assertEquals(
      await sessionRepo.getOneBySessionKey("first-session-key"),
      undefined,
    );
    assertEquals(await sessionRepo.list(), [second, service]);

    await sessionRepo.deleteByInstanceKey("svc-session-key");
    assertEquals(await sessionRepo.list(), [second]);
  });
});

Deno.test("session storage deletes device sessions by public identity key", async () => {
  await withRepositories(async ({ sessions: sessionRepo }) => {
    const first = makeDeviceSession({
      instanceId: "dev_1",
      publicIdentityKey: "public-identity-key-a",
    });
    const second = makeDeviceSession({
      instanceId: "dev_2",
      publicIdentityKey: "public-identity-key-b",
      contractDigest: "sha256-device-contract-b",
    });
    const service = makeServiceSession();
    await sessionRepo.put("public-identity-key-a", first);
    await sessionRepo.put("public-identity-key-b", second);
    await sessionRepo.put("service-session-key", service);

    await sessionRepo.deleteByPublicIdentityKey("public-identity-key-a");

    assertEquals(await sessionRepo.list(), [second, service]);
  });
});

Deno.test("portal storage upserts, gets, and lists by portal id", async () => {
  await withRepositories(async ({ portals: portalRepo }, storage) => {
    const first = makePortal({ portalId: "portal-b" });
    const second = makePortal({ portalId: "portal-a" });
    await portalRepo.put(first);
    await portalRepo.put(second);

    const [row] = await storage.db.select().from(portals).where(
      eq(portals.portalId, "portal-b"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.portalId, first.portalId);

    const updated = makePortal({ portalId: "portal-b", disabled: true });
    await portalRepo.put(updated);

    assertEquals(await portalRepo.get("portal-b"), updated);
    assertEquals(await portalRepo.list(), [second, updated]);
  });
});

Deno.test("portal profile storage upserts, disables, deletes, and lists", async () => {
  await withRepositories(async ({ portalProfiles: deployments }, storage) => {
    const first = makePortalProfile({ portalId: "portal-b" });
    const second = makePortalProfile({
      portalId: "portal-a",
      contractId: "agent@v1",
      allowedOrigins: undefined,
      impliedCapabilities: [],
    });
    await deployments.put(first);
    await deployments.put(second);

    const [row] = await storage.db.select().from(portalProfiles).where(
      eq(portalProfiles.portalId, "portal-b"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.portalId, first.portalId);

    const updated = makePortalProfile({
      portalId: "portal-b",
      allowedOrigins: undefined,
      impliedCapabilities: ["items.read", "items.write"],
      updatedAt: "2026-04-26T00:00:02.000Z",
    });
    await deployments.put(updated);

    assertEquals(await deployments.get("portal-b"), updated);
    assertEquals(await deployments.list(), [second, updated]);
    assertEquals(
      await deployments.disable("portal-b", "2026-04-26T00:00:03.000Z"),
      { ...updated, disabled: true, updatedAt: "2026-04-26T00:00:03.000Z" },
    );
    await deployments.delete("portal-a");
    assertEquals(await deployments.get("portal-a"), undefined);
  });
});

Deno.test("portal default storage upserts login and device defaults", async () => {
  await withRepositories(async ({ portalDefaults: defaults }, storage) => {
    const first: LoginPortalDefault = { portalId: null };
    const device: DevicePortalDefault = { portalId: "device-portal" };
    await defaults.putLogin(first);
    await defaults.putDevice(device);

    const rows = await storage.db.select().from(portalDefaults).orderBy(
      portalDefaults.defaultKey,
    );
    assertEquals(rows.length, 2);
    assertMatch(rows[0].id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(rows[0].defaultKey, "device.default");
    assertEquals(rows[0].portalId, "device-portal");
    assertMatch(rows[1].id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(rows[1].defaultKey, "login.default");
    assertEquals(rows[1].portalId, null);
    assertEquals(await defaults.getLogin(), first);
    assertEquals(await defaults.getDevice(), device);

    const updated: LoginPortalDefault = { portalId: "portal-a" };
    const updatedDevice: DevicePortalDefault = { portalId: null };
    await defaults.putLogin(updated);
    await defaults.putDevice(updatedDevice);
    assertEquals(await defaults.getLogin(), updated);
    assertEquals(await defaults.getDevice(), updatedDevice);
  });
});

Deno.test("login portal selection storage upserts, deletes, and lists by contract id", async () => {
  await withRepositories(async ({ loginSelections }, storage) => {
    const first: LoginPortalSelection = {
      contractId: "zeta@v1",
      portalId: "portal-z",
    };
    const second: LoginPortalSelection = {
      contractId: "alpha@v1",
      portalId: null,
    };
    await loginSelections.put(first);
    await loginSelections.put(second);

    const [row] = await storage.db.select().from(loginPortalSelections).where(
      eq(loginPortalSelections.contractId, "zeta@v1"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.selectionKey, "contract.zeta@v1");
    assertEquals(row.contractId, first.contractId);

    const updated: LoginPortalSelection = {
      contractId: "zeta@v1",
      portalId: "portal-a",
    };
    await loginSelections.put(updated);

    assertEquals(await loginSelections.get("zeta@v1"), updated);
    assertEquals(await loginSelections.list(), [second, updated]);
    await loginSelections.delete("alpha@v1");
    assertEquals(await loginSelections.get("alpha@v1"), undefined);
  });
});

Deno.test("device portal selection storage upserts, deletes, and lists by deployment id", async () => {
  await withRepositories(async ({ deviceSelections }, storage) => {
    const first: DevicePortalSelection = {
      deploymentId: "deployment-z",
      portalId: "portal-z",
    };
    const second: DevicePortalSelection = {
      deploymentId: "deployment-a",
      portalId: null,
    };
    await deviceSelections.put(first);
    await deviceSelections.put(second);

    const [row] = await storage.db.select().from(devicePortalSelections).where(
      eq(devicePortalSelections.deploymentId, "deployment-z"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.selectionKey, "deployment.deployment-z");
    assertEquals(row.deploymentId, first.deploymentId);

    const updated: DevicePortalSelection = {
      deploymentId: "deployment-z",
      portalId: "portal-a",
    };
    await deviceSelections.put(updated);

    assertEquals(await deviceSelections.get("deployment-z"), updated);
    assertEquals(await deviceSelections.list(), [second, updated]);
    await deviceSelections.delete("deployment-a");
    assertEquals(await deviceSelections.get("deployment-a"), undefined);
  });
});

Deno.test("instance grant policy storage upserts, disables, deletes, and lists", async () => {
  await withRepositories(async ({ policies }, storage) => {
    const first = makePolicy({ contractId: "zeta@v1" });
    const second = makePolicy({
      contractId: "alpha@v1",
      allowedOrigins: undefined,
      impliedCapabilities: [],
      source: {
        kind: "portal_profile",
        portalId: "portal-a",
        entryUrl: "https://portal.example.com/login",
      },
    });
    await policies.put(first);
    await policies.put(second);

    const [row] = await storage.db.select().from(instanceGrantPolicies).where(
      eq(instanceGrantPolicies.contractId, "zeta@v1"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.contractId, first.contractId);

    const updated = makePolicy({
      contractId: "zeta@v1",
      allowedOrigins: undefined,
      impliedCapabilities: ["items.write"],
      updatedAt: "2026-04-26T00:00:02.000Z",
    });
    await policies.put(updated);

    assertEquals(await policies.get("zeta@v1"), updated);
    assertEquals(await policies.list(), [second, updated]);
    assertEquals(
      await policies.disable("zeta@v1", "2026-04-26T00:00:03.000Z"),
      { ...updated, disabled: true, updatedAt: "2026-04-26T00:00:03.000Z" },
    );
    await policies.delete("alpha@v1");
    assertEquals(await policies.get("alpha@v1"), undefined);
  });
});

Deno.test("service deployment storage upserts, deletes, and lists by deployment id", async () => {
  await withRepositories(
    async ({ serviceDeployments: deployments }, storage) => {
      const first = makeServiceDeployment({ deploymentId: "svc-deployment-b" });
      const second = makeServiceDeployment({
        deploymentId: "svc-deployment-a",
        namespaces: [],
        appliedContracts: [],
      });
      await deployments.put(first);
      await deployments.put(second);

      const [row] = await storage.db.select().from(serviceDeployments).where(
        eq(serviceDeployments.deploymentId, "svc-deployment-b"),
      );
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assertEquals(row.deploymentId, first.deploymentId);

      const updated = makeServiceDeployment({
        deploymentId: "svc-deployment-b",
        disabled: true,
        namespaces: ["search"],
        appliedContracts: [{
          contractId: "svc.search@v1",
          allowedDigests: ["sha256-service-b", "sha256-service-c"],
          resourceBindingsByDigest: {
            "sha256-service-b": {
              kv: { cache: { bucket: "search-cache", history: 1, ttlMs: 0 } },
            },
          },
        }],
      });
      await deployments.put(updated);

      assertEquals(await deployments.get("svc-deployment-b"), updated);
      assertEquals(await deployments.list(), [second, updated]);
      await deployments.delete("svc-deployment-a");
      assertEquals(await deployments.get("svc-deployment-a"), undefined);
    },
  );
});

Deno.test("service instance storage upserts, deletes, and looks up by instance key", async () => {
  await withRepositories(async ({ serviceInstances: instances }, storage) => {
    const first = makeServiceInstance({ instanceId: "svc_instance_b" });
    const second = makeServiceInstance({
      instanceId: "svc_instance_a",
      deploymentId: "svc-deployment-b",
      instanceKey: "session-key-b",
      currentContractId: undefined,
      currentContractDigest: undefined,
      capabilities: [],
      resourceBindings: undefined,
    });
    await instances.put(first);
    await instances.put(second);

    const [row] = await storage.db.select().from(serviceInstances).where(
      eq(serviceInstances.instanceId, "svc_instance_b"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.instanceId, first.instanceId);
    assertEquals(row.instanceKey, first.instanceKey);

    const updated = makeServiceInstance({
      instanceId: "svc_instance_b",
      deploymentId: "svc-deployment-a",
      instanceKey: "session-key-c",
      disabled: true,
      currentContractId: "svc.search@v1",
      currentContractDigest: "sha256-service-c",
      capabilities: ["service", "search.query"],
      resourceBindings: { store: { output: { name: "results", ttlMs: 0 } } },
      createdAt: "2026-04-26T00:00:01.000Z",
    });
    await instances.put(updated);

    assertEquals(await instances.get("svc_instance_b"), updated);
    assertEquals(await instances.getByInstanceKey("session-key-c"), updated);
    assertEquals(await instances.getByInstanceKey("session-key-c"), updated);
    assertEquals(await instances.list(), [second, updated]);
    assertEquals(await instances.listByDeployment("svc-deployment-a"), [
      updated,
    ]);
    await instances.delete("svc_instance_a");
    assertEquals(await instances.get("svc_instance_a"), undefined);
  });
});

Deno.test("device deployment storage upserts, deletes, and lists by deployment id", async () => {
  await withRepositories(
    async ({ deviceDeployments: deployments }, storage) => {
      const first = makeDeviceDeployment({ deploymentId: "dev-deployment-b" });
      const second = makeDeviceDeployment({
        deploymentId: "dev-deployment-a",
        reviewMode: undefined,
        appliedContracts: [],
      });
      await deployments.put(first);
      await deployments.put(second);

      const [row] = await storage.db.select().from(deviceDeployments).where(
        eq(deviceDeployments.deploymentId, "dev-deployment-b"),
      );
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assertEquals(row.deploymentId, first.deploymentId);

      const updated = makeDeviceDeployment({
        deploymentId: "dev-deployment-b",
        reviewMode: "none",
        disabled: true,
        appliedContracts: [{
          contractId: "device.writer@v1",
          allowedDigests: ["sha256-device-b", "sha256-device-c"],
        }],
      });
      await deployments.put(updated);

      assertEquals(await deployments.get("dev-deployment-b"), updated);
      assertEquals(await deployments.list(), [second, updated]);
      await deployments.delete("dev-deployment-a");
      assertEquals(await deployments.get("dev-deployment-a"), undefined);
    },
  );
});

Deno.test("device deployment storage omits service-only resource bindings", async () => {
  await withRepositories(
    async ({ deviceDeployments: deployments }, storage) => {
      await storage.db.insert(deviceDeployments).values({
        deploymentId: "dev-deployment-resource-bound",
        reviewMode: "none",
        disabled: false,
        appliedContracts: JSON.stringify([{
          contractId: "device.reader@v1",
          allowedDigests: ["sha256-device-a"],
          resourceBindingsByDigest: {
            "sha256-device-a": {
              kv: { cache: { bucket: "reader-cache", history: 1, ttlMs: 0 } },
            },
          },
        }]),
      });

      assertEquals(await deployments.get("dev-deployment-resource-bound"), {
        deploymentId: "dev-deployment-resource-bound",
        reviewMode: "none",
        disabled: false,
        appliedContracts: [{
          contractId: "device.reader@v1",
          allowedDigests: ["sha256-device-a"],
        }],
      });
    },
  );
});

Deno.test("device instance storage upserts, deletes, and alternate lookups", async () => {
  await withRepositories(async ({ deviceInstances: instances }, storage) => {
    const first = makeDeviceInstance({ instanceId: "dev_instance_b" });
    const second = makeDeviceInstance({
      instanceId: "dev_instance_a",
      publicIdentityKey: "pub_identity_b",
      deploymentId: "dev-deployment-b",
      metadata: undefined,
    });
    await instances.put(first);
    await instances.put(second);

    const [row] = await storage.db.select().from(deviceInstances).where(
      eq(deviceInstances.instanceId, "dev_instance_b"),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.instanceId, first.instanceId);
    assertEquals(row.publicIdentityKey, first.publicIdentityKey);

    const updated = makeDeviceInstance({
      instanceId: "dev_instance_b",
      state: "activated",
      activatedAt: "2026-04-26T00:00:02.000Z",
    });
    await instances.put(updated);

    assertEquals(await instances.get("dev_instance_b"), updated);
    assertEquals(
      await instances.getByPublicIdentityKey("pub_identity_a"),
      updated,
    );
    assertEquals(await instances.list(), [second, updated]);
    assertEquals(await instances.listByDeployment("dev-deployment-a"), [
      updated,
    ]);
    await instances.delete("dev_instance_a");
    assertEquals(await instances.get("dev_instance_a"), undefined);
  });
});

Deno.test("device provisioning secret storage upserts and deletes by instance id", async () => {
  await withRepositories(
    async ({ deviceProvisioningSecrets: secrets }, storage) => {
      const first = makeDeviceProvisioningSecret();
      await secrets.put(first);

      const [row] = await storage.db.select().from(deviceProvisioningSecrets)
        .where(eq(deviceProvisioningSecrets.instanceId, first.instanceId));
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assertEquals(row.instanceId, first.instanceId);

      const updated = makeDeviceProvisioningSecret({
        activationKey: "activation-key-b",
        createdAt: new Date("2026-04-26T00:00:01.000Z"),
      });
      await secrets.put(updated);

      assertEquals(await secrets.get(first.instanceId), {
        ...updated,
        createdAt: new Date("2026-04-26T00:00:01.000Z"),
      });
      await secrets.delete(first.instanceId);
      assertEquals(await secrets.get(first.instanceId), undefined);
    },
  );
});

Deno.test("device activation storage upserts, deletes, and alternate lookups", async () => {
  await withRepositories(
    async ({ deviceActivations: activations }, storage) => {
      const first = makeDeviceActivation({ instanceId: "dev_instance_b" });
      const second = makeDeviceActivation({
        instanceId: "dev_instance_a",
        publicIdentityKey: "pub_identity_b",
        activatedBy: undefined,
      });
      await activations.put(first);
      await activations.put(second);

      const [row] = await storage.db.select().from(deviceActivations).where(
        eq(deviceActivations.instanceId, "dev_instance_b"),
      );
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assertEquals(row.instanceId, first.instanceId);
      assertEquals(row.publicIdentityKey, first.publicIdentityKey);

      const updated = makeDeviceActivation({
        instanceId: "dev_instance_b",
        state: "revoked",
        revokedAt: "2026-04-26T00:00:02.000Z",
      });
      await activations.put(updated);

      assertEquals(await activations.get("dev_instance_b"), updated);
      assertEquals(
        await activations.getByPublicIdentityKey("pub_identity_a"),
        updated,
      );
      assertEquals(await activations.list(), [second, updated]);
      await activations.delete("dev_instance_a");
      assertEquals(await activations.get("dev_instance_a"), undefined);
    },
  );
});

Deno.test("device activation review storage upserts, deletes, and flow lookup", async () => {
  await withRepositories(
    async ({ deviceActivationReviews: reviews }, storage) => {
      const first = makeDeviceActivationReview({ reviewId: "dar_b" });
      const second = makeDeviceActivationReview({
        reviewId: "dar_a",
        operationId: "op_activate_b",
        flowId: "flow_b",
        instanceId: "dev_instance_b",
      });
      await reviews.put(first);
      await reviews.put(second);

      const [row] = await storage.db.select().from(deviceActivationReviews)
        .where(eq(deviceActivationReviews.reviewId, "dar_b"));
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assertEquals(row.reviewId, first.reviewId);
      assertEquals(row.operationId, first.operationId);
      assertEquals(row.flowId, first.flowId);

      const updated = makeDeviceActivationReview({
        reviewId: "dar_b",
        state: "approved",
        decidedAt: new Date("2026-04-26T00:00:02.000Z"),
        reason: "approved by reviewer",
      });
      await reviews.put(updated);

      assertEquals(await reviews.get("dar_b"), updated);
      assertEquals(await reviews.getByFlowId("flow_a"), updated);
      assertEquals(await reviews.list(), [second, updated]);
      await reviews.delete("dar_a");
      assertEquals(await reviews.get("dar_a"), undefined);
    },
  );
});
