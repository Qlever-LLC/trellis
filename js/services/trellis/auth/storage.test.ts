import { assertEquals, assertInstanceOf, assertMatch } from "@std/assert";
import { eq } from "drizzle-orm";
import type { StaticDecode } from "typebox";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { TrellisStorage } from "../storage/db.ts";
import { identityIdForProviderSubject } from "./identity.ts";
import {
  accountFlows,
  authPortals,
  deviceActivationReviews,
  deviceActivations,
  deviceDeployments,
  deviceInstances,
  deviceProvisioningSecrets,
  identityEnvelopes,
  localCredentials,
  serviceDeployments,
  serviceInstances,
  sessions,
  userIdentities,
  users as usersTable,
} from "../storage/schema.ts";
import type {
  AccountFlow,
  CapabilityGroup,
  DeviceSession,
  IdentityEnvelopeRecord,
  LocalCredential,
  ServiceSession,
  Session,
  UserAccount,
  UserIdentity,
  UserProjectionEntry,
  UserSession,
} from "./schemas.ts";
import {
  DeviceActivationRecordSchema,
  DeviceActivationReviewRecordSchema,
  DeviceDeploymentSchema,
  DeviceProvisioningSecretSchema,
  DeviceSchema,
  ServiceDeploymentSchema,
  ServiceInstanceSchema,
} from "./schemas.ts";
import {
  SqlAccountFlowRepository,
  SqlCapabilityGroupRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlIdentityEnvelopeRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

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
      accounts: SqlUserAccountRepository;
      userIdentities: SqlUserIdentityRepository;
      localCredentials: SqlLocalCredentialRepository;
      accountFlows: SqlAccountFlowRepository;
      capabilityGroups: SqlCapabilityGroupRepository;
      users: SqlUserProjectionRepository;
      approvals: SqlIdentityEnvelopeRepository;
      serviceDeployments: SqlServiceDeploymentRepository;
      serviceInstances: SqlServiceInstanceRepository;
      deviceDeployments: SqlDeviceDeploymentRepository;
      deviceInstances: SqlDeviceInstanceRepository;
      deviceProvisioningSecrets: SqlDeviceProvisioningSecretRepository;
      deviceActivations: SqlDeviceActivationRepository;
      deviceActivationReviews: SqlDeviceActivationReviewRepository;
      sessions: SqlSessionRepository;
      loginPortals: SqlLoginPortalRepository;
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
      accounts: new SqlUserAccountRepository(storage.db),
      userIdentities: new SqlUserIdentityRepository(storage.db),
      localCredentials: new SqlLocalCredentialRepository(storage.db),
      accountFlows: new SqlAccountFlowRepository(storage.db),
      capabilityGroups: new SqlCapabilityGroupRepository(storage.db),
      users: new SqlUserProjectionRepository(storage.db),
      approvals: new SqlIdentityEnvelopeRepository(storage.db),
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
      loginPortals: new SqlLoginPortalRepository(storage.db),
    }, storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeServiceDeployment(
  overrides: Partial<ServiceDeployment> = {},
): ServiceDeployment {
  return {
    deploymentId: "svc-deployment-a",
    namespaces: ["graph", "search"],
    disabled: false,
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
    capabilityGroups: [],
    ...overrides,
  };
}

function makeAccount(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    userId: "usr_01HXACCOUNT000000000000000",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    capabilities: ["catalog.read"],
    capabilityGroups: [],
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeCapabilityGroup(
  overrides: Partial<CapabilityGroup> = {},
): CapabilityGroup {
  return {
    groupKey: "customer.default",
    displayName: "Customer Default",
    description: "Default customer permissions.",
    capabilities: ["customer.read"],
    includedGroups: [],
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeUserIdentity(
  overrides: Partial<UserIdentity> = {},
): UserIdentity {
  return {
    identityId: "idn_github_123",
    userId: "usr_01HXACCOUNT000000000000000",
    provider: "github",
    subject: "123",
    displayName: "Ada",
    email: "ada@example.com",
    emailVerified: true,
    linkedAt: "2026-04-26T00:00:01.000Z",
    lastLoginAt: null,
    ...overrides,
  };
}

function makeLocalCredential(
  overrides: Partial<LocalCredential> = {},
): LocalCredential {
  return {
    identityId: "idn_local_ada",
    passwordHash: "hash-v1",
    passwordAlgorithm: "argon2id",
    passwordParams: { memory: 65536, iterations: 3 },
    passwordSetAt: "2026-04-26T00:00:02.000Z",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    updatedAt: "2026-04-26T00:00:02.000Z",
    ...overrides,
  };
}

function makeAccountFlow(overrides: Partial<AccountFlow> = {}): AccountFlow {
  return {
    flowIdHash: "sha256-flow-a",
    kind: "account_invite",
    targetUserId: "usr_01HXACCOUNT000000000000000",
    createdByUserId: "usr_01HXADMIN00000000000000",
    allowedProviders: ["local", "github"],
    capabilities: ["catalog.read"],
    profileHint: { name: "Ada Lovelace", email: "ada@example.com" },
    createdAt: "2026-04-26T00:00:03.000Z",
    expiresAt: "2026-04-27T00:00:03.000Z",
    consumedAt: null,
    ...overrides,
  };
}

function makeApproval(
  overrides: Partial<IdentityEnvelopeRecord> = {},
): IdentityEnvelopeRecord {
  return {
    identityEnvelopeId: "env-app-a",
    userTrellisId: "github.user-1",
    origin: "github",
    id: "user-1",
    identityAnchor: {
      kind: "web",
      contractId: "app@v1",
      origin: "https://app.example",
    },
    answer: "approved",
    answeredAt: new Date("2026-04-26T00:00:00.000Z"),
    updatedAt: new Date("2026-04-26T00:00:01.000Z"),
    approvalEvidence: {
      contractDigest: "sha256-contract-a",
      contractId: "app@v1",
      displayName: "Test App",
      description: "Test app contract",
      participantKind: "app",
      capabilities: {
        "items.read": {
          displayName: "Read items",
          description: "View item records.",
        },
      },
    },
    publishSubjects: ["events.v1.Items.Updated"],
    subscribeSubjects: ["rpc.v1.Items.Get"],
    ...overrides,
  };
}

function makeUserSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    userId: "usr_user_1",
    identity: {
      identityId: "idn_github_user_1",
      provider: "github",
      subject: "user-1",
    },
    email: "ada@example.com",
    name: "Ada Lovelace",
    participantKind: "app",
    identityEnvelopeId: "env-user-app",
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

Deno.test("account storage upserts, gets, and lists accounts", async () => {
  await withRepositories(async ({ accounts }, storage) => {
    const first = makeAccount();
    await accounts.put(first);

    assertEquals(await accounts.get(first.userId), first);
    assertEquals(await accounts.get("missing"), undefined);

    const [row] = await storage.db.select().from(usersTable);
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.userId, first.userId);

    const updated = makeAccount({
      name: null,
      email: "updated@example.com",
      active: false,
      capabilities: ["catalog.read", "catalog.write"],
      updatedAt: "2026-04-26T00:00:10.000Z",
    });
    await accounts.put(updated);

    const second = makeAccount({
      userId: "usr_01HXACCOUNT000000000000001",
      email: null,
      capabilities: [],
    });
    await accounts.put(second);

    assertEquals(await accounts.get(first.userId), updated);
    assertEquals(await accounts.listPage({ limit: 10 }), [updated, second]);
  });
});

Deno.test("account storage creates without replacing duplicates", async () => {
  await withRepositories(async ({ accounts }) => {
    const first = makeAccount();
    const duplicate = makeAccount({
      name: "Changed Name",
      updatedAt: "2026-04-26T00:00:10.000Z",
    });

    assertEquals(await accounts.create(first), true);
    assertEquals(await accounts.create(duplicate), false);
    assertEquals(await accounts.get(first.userId), first);
  });
});

Deno.test("login portal storage provides built-in default policy", async () => {
  await withRepositories(async ({ loginPortals }, storage) => {
    const selected = await loginPortals.resolveForApp({});

    assertEquals(selected.portal.portalId, "trellis.builtin.login");
    assertEquals(selected.settings.localRegistrationEnabled, true);
    assertEquals(selected.settings.federatedRegistrationEnabled, true);
    assertEquals(selected.settings.selfRegisteredAccountActive, true);
    assertEquals(selected.defaultCapabilities, []);
    assertEquals(selected.defaultCapabilityGroups, []);
    const [row] = await storage.db.select().from(authPortals);
    assertEquals(row?.portalId, "trellis.builtin.login");
    assertEquals(
      await loginPortals.deletePortal("trellis.builtin.login"),
      false,
    );
  });
});

Deno.test("login portal self-registration creates local account atomically", async () => {
  await withRepositories(async ({
    accounts,
    localCredentials,
    loginPortals,
    userIdentities,
  }) => {
    const result = await loginPortals.registerLocalIdentity({
      username: "alex",
      password: "correct horse battery staple",
      name: "Alex Local",
      email: "alex@example.com",
      active: true,
      capabilities: ["profile.basic"],
      capabilityGroups: ["users"],
      userId: "usr_self_registered",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assertEquals(result.ok, true);
    assertEquals(await accounts.get("usr_self_registered"), {
      userId: "usr_self_registered",
      name: "Alex Local",
      email: "alex@example.com",
      active: true,
      capabilities: ["profile.basic"],
      capabilityGroups: ["users"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const identityId = identityIdForProviderSubject("local", "alex");
    assertEquals(
      await userIdentities.getByProviderSubject("local", "alex"),
      {
        identityId,
        userId: "usr_self_registered",
        provider: "local",
        subject: "alex",
        displayName: "Alex Local",
        email: "alex@example.com",
        emailVerified: false,
        linkedAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: "2026-01-01T00:00:00.000Z",
      },
    );
    assertEquals(
      (await localCredentials.get(identityId))?.identityId,
      identityId,
    );

    const duplicate = await loginPortals.registerLocalIdentity({
      username: "alex",
      password: "different password",
      name: "Alex Duplicate",
      email: "dup@example.com",
      active: true,
      capabilities: [],
      capabilityGroups: [],
      userId: "usr_duplicate",
    });
    assertEquals(duplicate, { ok: false, error: "identity_conflict" });
    assertEquals(await accounts.get("usr_duplicate"), undefined);
  });
});

Deno.test("capability group storage upserts, lists, and deletes groups", async () => {
  await withRepositories(async ({ capabilityGroups }) => {
    const first = makeCapabilityGroup();
    await capabilityGroups.put(first);
    assertEquals(await capabilityGroups.get(first.groupKey), first);

    const updated = makeCapabilityGroup({
      displayName: "Updated Customer Default",
      capabilities: ["customer.read", "customer.write"],
      includedGroups: ["nested.group"],
      updatedAt: "2026-04-26T01:00:00.000Z",
    });
    await capabilityGroups.put(updated);
    const second = makeCapabilityGroup({
      groupKey: "nested.group",
      displayName: "Nested",
      description: "Nested group.",
      capabilities: ["nested.read"],
    });
    await capabilityGroups.put(second);

    assertEquals(await capabilityGroups.get(first.groupKey), updated);
    assertEquals(await capabilityGroups.listPage({ limit: 10 }), [
      updated,
      second,
    ]);

    await capabilityGroups.delete(first.groupKey);
    assertEquals(await capabilityGroups.get(first.groupKey), undefined);
  });
});

Deno.test("user identity storage links and looks up by provider subject", async () => {
  await withRepositories(async ({ userIdentities: identityRepo }, storage) => {
    const first = makeUserIdentity();
    await identityRepo.put(first);

    assertEquals(await identityRepo.get(first.identityId), first);
    assertEquals(
      await identityRepo.getByProviderSubject("github", "123"),
      first,
    );
    assertEquals(
      await identityRepo.getByProviderSubject("github", "missing"),
      undefined,
    );

    const [row] = await storage.db.select().from(userIdentities);
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.provider, "github");

    const updated = makeUserIdentity({
      displayName: null,
      lastLoginAt: "2026-04-26T01:00:00.000Z",
    });
    await identityRepo.put(updated);

    const second = makeUserIdentity({
      identityId: "idn_oidc_456",
      provider: "oidc.acme",
      subject: "456",
      email: null,
    });
    await identityRepo.put(second);

    assertEquals(await identityRepo.get(first.identityId), updated);
    assertEquals(await identityRepo.listByUser(first.userId), [
      updated,
      second,
    ]);
  });
});

Deno.test("user identity storage unlinks by user and identity id", async () => {
  await withRepositories(async ({ userIdentities: identityRepo }) => {
    const first = makeUserIdentity();
    const second = makeUserIdentity({
      identityId: "idn_oidc_456",
      provider: "oidc.acme",
      subject: "456",
    });
    await identityRepo.put(first);
    await identityRepo.put(second);

    assertEquals(
      await identityRepo.unlink("usr_missing", first.identityId),
      false,
    );
    assertEquals(
      await identityRepo.unlink(first.userId, first.identityId),
      true,
    );
    assertEquals(
      await identityRepo.unlink(first.userId, first.identityId),
      false,
    );
    assertEquals(await identityRepo.get(first.identityId), undefined);
    assertEquals(await identityRepo.listByUser(first.userId), [second]);
  });
});

Deno.test("local credential storage upserts and gets credentials", async () => {
  await withRepositories(
    async ({ localCredentials: credentialRepo }, storage) => {
      const first = makeLocalCredential();
      await credentialRepo.put(first);

      assertEquals(await credentialRepo.get(first.identityId), first);
      assertEquals(await credentialRepo.get("missing"), undefined);

      const [row] = await storage.db.select().from(localCredentials);
      assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assertEquals(row.passwordAlgorithm, "argon2id");

      const updated = makeLocalCredential({
        passwordHash: "hash-v2",
        mustChangePassword: true,
        failedLoginCount: 4,
        lockedUntil: "2026-04-26T01:15:00.000Z",
        updatedAt: "2026-04-26T01:00:00.000Z",
      });
      await credentialRepo.put(updated);

      assertEquals(await credentialRepo.get(first.identityId), updated);
    },
  );
});

Deno.test("account flow storage gets, consumes, and lists expired flows", async () => {
  await withRepositories(async ({ accountFlows: flowRepo }, storage) => {
    const active = makeAccountFlow();
    const expired = makeAccountFlow({
      flowIdHash: "sha256-flow-expired",
      expiresAt: "2026-04-25T00:00:00.000Z",
    });
    const consumedExpired = makeAccountFlow({
      flowIdHash: "sha256-flow-consumed-expired",
      expiresAt: "2026-04-24T00:00:00.000Z",
      consumedAt: "2026-04-24T01:00:00.000Z",
    });

    await flowRepo.put(active);
    await flowRepo.put(expired);
    await flowRepo.put(consumedExpired);

    assertEquals(await flowRepo.get(active.flowIdHash), active);
    assertEquals(await flowRepo.get("missing"), undefined);

    const [row] = await storage.db.select().from(accountFlows).where(
      eq(accountFlows.flowIdHash, active.flowIdHash),
    );
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.allowedProviders, JSON.stringify(active.allowedProviders));

    assertEquals(
      await flowRepo.listExpired("2026-04-26T00:00:00.000Z", { limit: 10 }),
      [expired],
    );
    assertEquals(
      await flowRepo.consume(active.flowIdHash, "2026-04-26T00:00:04.000Z"),
      true,
    );
    assertEquals(
      await flowRepo.consume(active.flowIdHash, "2026-04-26T00:00:05.000Z"),
      false,
    );
    assertEquals(await flowRepo.get(active.flowIdHash), {
      ...active,
      consumedAt: "2026-04-26T00:00:04.000Z",
    });
  });
});

Deno.test("account flow atomic local bootstrap completion writes all records", async () => {
  await withRepositories(async (
    {
      accounts,
      accountFlows: flowRepo,
      localCredentials: credentials,
      userIdentities: identities,
    },
  ) => {
    const flow = makeAccountFlow({
      flowIdHash: "bootstrap-flow-hash",
      kind: "admin_bootstrap",
      targetUserId: null,
      createdByUserId: null,
      allowedProviders: null,
      capabilities: ["admin"],
      expiresAt: "2026-04-27T00:00:00.000Z",
    });
    const identityId = identityIdForProviderSubject("local", "ada");
    const account = makeAccount({
      userId: "usr_bootstrap_admin",
      name: "Ada Lovelace",
      capabilities: [],
      capabilityGroups: ["admin"],
    });
    const identity = makeUserIdentity({
      identityId,
      userId: account.userId,
      provider: "local",
      subject: "ada",
      emailVerified: false,
    });
    const credential = makeLocalCredential({ identityId });

    await flowRepo.put(flow);

    const result = await flowRepo.completeAdminBootstrapLocalPassword({
      flowIdHash: flow.flowIdHash,
      now: new Date("2026-04-26T00:00:04.000Z"),
      account,
      identity,
      credential,
    });

    assertEquals(result, { ok: true, userId: account.userId });
    assertEquals(await accounts.get(account.userId), account);
    assertEquals(await identities.get(identityId), identity);
    assertEquals(await credentials.get(identityId), credential);
    assertEquals(await flowRepo.get(flow.flowIdHash), {
      ...flow,
      consumedAt: "2026-04-26T00:00:04.000Z",
    });
  });
});

Deno.test("account flow atomic bootstrap completion detects group-derived admins", async () => {
  await withRepositories(async ({ accounts, accountFlows: flowRepo }) => {
    const flow = makeAccountFlow({
      flowIdHash: "bootstrap-flow-hash",
      kind: "admin_bootstrap",
      targetUserId: null,
      createdByUserId: null,
      allowedProviders: null,
      capabilities: ["admin"],
      expiresAt: "2026-04-27T00:00:00.000Z",
    });
    const existingAdmin = makeAccount({
      userId: "usr_existing_group_admin",
      capabilities: [],
      capabilityGroups: ["admin"],
    });
    const attemptedAccount = makeAccount({
      userId: "usr_attempted_admin",
      capabilities: [],
      capabilityGroups: ["admin"],
    });
    const identityId = identityIdForProviderSubject("local", "ada");

    await flowRepo.put(flow);
    await accounts.put(existingAdmin);

    const result = await flowRepo.completeAdminBootstrapLocalPassword({
      flowIdHash: flow.flowIdHash,
      now: new Date("2026-04-26T00:00:04.000Z"),
      account: attemptedAccount,
      identity: makeUserIdentity({
        identityId,
        userId: attemptedAccount.userId,
        provider: "local",
        subject: "ada",
      }),
      credential: makeLocalCredential({ identityId }),
    });

    assertEquals(result, { ok: false, error: "admin_already_exists" });
    assertEquals(await accounts.get(attemptedAccount.userId), undefined);
    assertEquals(await flowRepo.get(flow.flowIdHash), flow);
  });
});

Deno.test("account flow atomic local bootstrap completion rejects duplicate local identity", async () => {
  await withRepositories(async (
    {
      accounts,
      accountFlows: flowRepo,
      localCredentials: credentials,
      userIdentities: identities,
    },
  ) => {
    const flow = makeAccountFlow({
      flowIdHash: "bootstrap-flow-hash",
      kind: "admin_bootstrap",
      targetUserId: null,
      createdByUserId: null,
      allowedProviders: null,
      capabilities: ["admin"],
      expiresAt: "2026-04-27T00:00:00.000Z",
    });
    const identityId = identityIdForProviderSubject("local", "ada");
    const existingAccount = makeAccount({
      userId: "usr_existing_local",
      capabilities: [],
    });
    const existingIdentity = makeUserIdentity({
      identityId,
      userId: existingAccount.userId,
      provider: "local",
      subject: "ada",
      emailVerified: false,
    });
    const existingCredential = makeLocalCredential({
      identityId,
      passwordHash: "existing-hash",
    });

    await flowRepo.put(flow);
    await accounts.put(existingAccount);
    await identities.put(existingIdentity);
    await credentials.put(existingCredential);

    const result = await flowRepo.completeAdminBootstrapLocalPassword({
      flowIdHash: flow.flowIdHash,
      now: new Date("2026-04-26T00:00:04.000Z"),
      account: makeAccount({
        userId: "usr_attempted_admin",
        capabilities: [],
        capabilityGroups: ["admin"],
      }),
      identity: makeUserIdentity({
        identityId,
        userId: "usr_attempted_admin",
        provider: "local",
        subject: "ada",
        emailVerified: false,
      }),
      credential: makeLocalCredential({
        identityId,
        passwordHash: "new-hash",
      }),
    });

    assertEquals(result, { ok: false, error: "local_identity_exists" });
    assertEquals(await accounts.get("usr_attempted_admin"), undefined);
    assertEquals(await identities.get(identityId), existingIdentity);
    assertEquals(await credentials.get(identityId), existingCredential);
    assertEquals(await flowRepo.get(flow.flowIdHash), flow);
  });
});

Deno.test("account flow atomic local identity link rejects second local identity", async () => {
  await withRepositories(async (
    {
      accounts,
      accountFlows: flowRepo,
      localCredentials: credentials,
      userIdentities: identities,
    },
  ) => {
    const target = makeAccount({ userId: "usr_target_local" });
    const existingIdentityId = identityIdForProviderSubject("local", "ada");
    const existingIdentity = makeUserIdentity({
      identityId: existingIdentityId,
      userId: target.userId,
      provider: "local",
      subject: "ada",
      emailVerified: false,
    });
    const existingCredential = makeLocalCredential({
      identityId: existingIdentityId,
      passwordHash: "existing-hash",
    });
    const secondIdentityId = identityIdForProviderSubject(
      "local",
      "ada-second",
    );
    const flow = makeAccountFlow({
      flowIdHash: "target-local-second-flow-hash",
      kind: "identity_link",
      targetUserId: target.userId,
      allowedProviders: ["local"],
      capabilities: null,
      expiresAt: "2026-04-27T00:00:00.000Z",
    });

    await accounts.put(target);
    await identities.put(existingIdentity);
    await credentials.put(existingCredential);
    await flowRepo.put(flow);

    const result = await flowRepo.completeIdentityLinkLocalPassword({
      flowIdHash: flow.flowIdHash,
      now: new Date("2026-04-26T00:00:04.000Z"),
      identity: makeUserIdentity({
        identityId: secondIdentityId,
        userId: target.userId,
        provider: "local",
        subject: "ada-second",
        emailVerified: false,
      }),
      credential: makeLocalCredential({
        identityId: secondIdentityId,
        passwordHash: "new-hash",
      }),
    });

    assertEquals(result, { ok: false, error: "local_identity_exists" });
    assertEquals(await identities.get(existingIdentityId), existingIdentity);
    assertEquals(await identities.get(secondIdentityId), undefined);
    assertEquals(await credentials.get(existingIdentityId), existingCredential);
    assertEquals(await credentials.get(secondIdentityId), undefined);
    assertEquals(await flowRepo.get(flow.flowIdHash), flow);
  });
});

Deno.test("account flow atomic OAuth target completion links identity", async () => {
  await withRepositories(
    async (
      { accounts, accountFlows: flowRepo, userIdentities: identities },
    ) => {
      const target = makeAccount({ userId: "usr_target_oauth" });
      const flow = makeAccountFlow({
        flowIdHash: "target-oauth-flow-hash",
        kind: "identity_link",
        targetUserId: target.userId,
        allowedProviders: ["github"],
        expiresAt: "2026-04-27T00:00:00.000Z",
      });

      await accounts.put(target);
      await flowRepo.put(flow);

      const result = await flowRepo.completeTargetAccountOAuth({
        flowIdHash: flow.flowIdHash,
        now: new Date("2026-04-26T00:00:04.000Z"),
        provider: "github",
        user: {
          provider: "github",
          id: "ada-oauth",
          name: "Ada OAuth",
          email: "ada-oauth@example.com",
          emailVerified: true,
        },
      });

      const identityId = identityIdForProviderSubject("github", "ada-oauth");
      assertEquals(result, { ok: true, userId: target.userId });
      assertEquals(await identities.get(identityId), {
        identityId,
        userId: target.userId,
        provider: "github",
        subject: "ada-oauth",
        displayName: "Ada OAuth",
        email: "ada-oauth@example.com",
        emailVerified: true,
        linkedAt: "2026-04-26T00:00:04.000Z",
        lastLoginAt: "2026-04-26T00:00:04.000Z",
      });
      assertEquals(await flowRepo.get(flow.flowIdHash), {
        ...flow,
        consumedAt: "2026-04-26T00:00:04.000Z",
      });
    },
  );
});

Deno.test("account flow atomic OAuth target completion allows multiple OIDC identities", async () => {
  await withRepositories(
    async (
      { accounts, accountFlows: flowRepo, userIdentities: identities },
    ) => {
      const target = makeAccount({ userId: "usr_target_oauth" });
      const existingIdentity = makeUserIdentity({
        identityId: identityIdForProviderSubject("github", "ada-github"),
        userId: target.userId,
        provider: "github",
        subject: "ada-github",
      });
      const flow = makeAccountFlow({
        flowIdHash: "target-oauth-second-flow-hash",
        kind: "identity_link",
        targetUserId: target.userId,
        allowedProviders: ["google"],
        expiresAt: "2026-04-27T00:00:00.000Z",
      });

      await accounts.put(target);
      await identities.put(existingIdentity);
      await flowRepo.put(flow);

      const result = await flowRepo.completeTargetAccountOAuth({
        flowIdHash: flow.flowIdHash,
        now: new Date("2026-04-26T00:00:04.000Z"),
        provider: "google",
        user: {
          provider: "google",
          id: "ada-google",
          name: "Ada Google",
          email: "ada-google@example.com",
          emailVerified: true,
        },
      });

      const googleIdentityId = identityIdForProviderSubject(
        "google",
        "ada-google",
      );
      assertEquals(result, { ok: true, userId: target.userId });
      assertEquals(
        await identities.get(existingIdentity.identityId),
        existingIdentity,
      );
      assertEquals(await identities.get(googleIdentityId), {
        identityId: googleIdentityId,
        userId: target.userId,
        provider: "google",
        subject: "ada-google",
        displayName: "Ada Google",
        email: "ada-google@example.com",
        emailVerified: true,
        linkedAt: "2026-04-26T00:00:04.000Z",
        lastLoginAt: "2026-04-26T00:00:04.000Z",
      });
    },
  );
});

Deno.test("account flow atomic OAuth target completion preserves same-account identity", async () => {
  await withRepositories(
    async (
      { accounts, accountFlows: flowRepo, userIdentities: identities },
    ) => {
      const target = makeAccount({ userId: "usr_target_oauth" });
      const existingIdentity = makeUserIdentity({
        identityId: "idn_existing_github",
        userId: target.userId,
        provider: "github",
        subject: "ada-oauth",
        displayName: "Old Name",
        email: "old@example.com",
        linkedAt: "2026-04-25T00:00:00.000Z",
        lastLoginAt: "2026-04-25T00:00:00.000Z",
      });
      const flow = makeAccountFlow({
        flowIdHash: "target-oauth-existing-flow-hash",
        targetUserId: target.userId,
        allowedProviders: ["github"],
        expiresAt: "2026-04-27T00:00:00.000Z",
      });

      await accounts.put(target);
      await identities.put(existingIdentity);
      await flowRepo.put(flow);

      const result = await flowRepo.completeTargetAccountOAuth({
        flowIdHash: flow.flowIdHash,
        now: new Date("2026-04-26T00:00:04.000Z"),
        provider: "github",
        user: {
          provider: "github",
          id: "ada-oauth",
          name: "New Name",
          email: "new@example.com",
          emailVerified: false,
        },
      });

      assertEquals(result, { ok: true, userId: target.userId });
      assertEquals(await identities.get(existingIdentity.identityId), {
        ...existingIdentity,
        displayName: "New Name",
        email: "new@example.com",
        emailVerified: false,
        lastLoginAt: "2026-04-26T00:00:04.000Z",
      });
    },
  );
});

Deno.test("account flow atomic OAuth target completion rejects identity conflict", async () => {
  await withRepositories(
    async (
      { accounts, accountFlows: flowRepo, userIdentities: identities },
    ) => {
      const target = makeAccount({ userId: "usr_target_oauth" });
      const other = makeAccount({ userId: "usr_other_oauth" });
      const existingIdentity = makeUserIdentity({
        identityId: "idn_existing_github",
        userId: other.userId,
        provider: "github",
        subject: "ada-oauth",
      });
      const flow = makeAccountFlow({
        flowIdHash: "target-oauth-conflict-flow-hash",
        targetUserId: target.userId,
        allowedProviders: ["github"],
        expiresAt: "2026-04-27T00:00:00.000Z",
      });

      await accounts.put(target);
      await accounts.put(other);
      await identities.put(existingIdentity);
      await flowRepo.put(flow);

      const result = await flowRepo.completeTargetAccountOAuth({
        flowIdHash: flow.flowIdHash,
        now: new Date("2026-04-26T00:00:04.000Z"),
        provider: "github",
        user: {
          provider: "github",
          id: "ada-oauth",
          name: "Ada OAuth",
          email: "ada-oauth@example.com",
          emailVerified: true,
        },
      });

      assertEquals(result, { ok: false, error: "identity_conflict" });
      assertEquals(
        await identities.get(existingIdentity.identityId),
        existingIdentity,
      );
      assertEquals(await flowRepo.get(flow.flowIdHash), flow);
    },
  );
});

Deno.test("identity envelope storage upserts, gets, and preserves Date fields", async () => {
  await withRepositories(async ({ approvals }, storage) => {
    const first = makeApproval();
    await approvals.put(first);

    const stored = await approvals.get(first.identityEnvelopeId);
    assertEquals(stored, first);
    assertInstanceOf(stored?.answeredAt, Date);
    assertInstanceOf(stored?.updatedAt, Date);

    const [row] = await storage.db.select().from(identityEnvelopes);
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
      await approvals.get(updated.identityEnvelopeId),
      updated,
    );
  });
});

Deno.test("identity envelope storage lists by user and all envelopes", async () => {
  await withRepositories(async ({ approvals }) => {
    const first = makeApproval({
      userTrellisId: "github.user-1",
      identityEnvelopeId: "env-a",
      approvalEvidence: {
        ...makeApproval().approvalEvidence,
        contractDigest: "sha256-contract-a",
      },
    });
    const second = makeApproval({
      userTrellisId: "github.user-1",
      identityEnvelopeId: "env-b",
      identityAnchor: {
        kind: "cli",
        contractId: "agent@v1",
        sessionPublicKey: "session-agent",
      },
      approvalEvidence: {
        ...makeApproval().approvalEvidence,
        contractDigest: "sha256-contract-b",
        contractId: "agent@v1",
        participantKind: "agent",
      },
    });
    const third = makeApproval({
      userTrellisId: "github.user-2",
      identityEnvelopeId: "env-c",
      id: "user-2",
      approvalEvidence: {
        ...makeApproval().approvalEvidence,
        contractDigest: "sha256-contract-a",
      },
    });

    await approvals.put(second);
    await approvals.put(third);
    await approvals.put(first);

    assertEquals(await approvals.listByUser("github.user-1"), [first, second]);
    assertEquals(
      await approvals.listPageByUser("github.user-1", { limit: 1 }),
      [
        first,
      ],
    );
    assertEquals(
      await approvals.listApprovedPageByUser("github.user-1", { limit: 10 }),
      [first, second],
    );
    assertEquals(await approvals.listPage({ limit: 10 }), [
      first,
      second,
      third,
    ]);
    assertEquals(await approvals.listApproved(), [first, second, third]);
    assertEquals(
      await approvals.listByApprovalEvidenceContractDigests([
        "sha256-contract-a",
      ]),
      [first, third],
    );
  });
});

Deno.test("identity envelope storage deletes by envelope id", async () => {
  await withRepositories(async ({ approvals }) => {
    const first = makeApproval();
    const second = makeApproval({
      identityEnvelopeId: "env-b",
      identityAnchor: {
        kind: "cli",
        contractId: "agent@v1",
        sessionPublicKey: "session-agent",
      },
      approvalEvidence: {
        ...makeApproval().approvalEvidence,
        contractDigest: "sha256-contract-b",
      },
    });
    await approvals.put(first);
    await approvals.put(second);

    await approvals.delete(first.identityEnvelopeId);

    assertEquals(
      await approvals.get(first.identityEnvelopeId),
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
      userId: "usr_user_2",
      identity: {
        identityId: "idn_github_user_2",
        provider: "github",
        subject: "user-2",
      },
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
    assertEquals(await sessionRepo.listByUser("usr_user_1"), [user]);
    assertEquals(await sessionRepo.listByInstanceKey("svc-session-key"), [
      service,
    ]);
    assertEquals(await sessionRepo.listEntriesByUser("usr_user_1"), [{
      sessionKey: "user-session-key",
      principalId: "usr_user_1",
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
    assertEquals(
      await sessionRepo.listEntriesForDeploymentEnvelopePreview(
        "svc-deployment-a",
      ),
      [
        {
          sessionKey: "other-user-session-key",
          principalId: "usr_user_2",
          session: otherUser,
        },
        {
          sessionKey: "service-session-key",
          principalId: "svc_1",
          session: service,
        },
        {
          sessionKey: "user-session-key",
          principalId: "usr_user_1",
          session: user,
        },
      ],
    );
    assertEquals(
      await sessionRepo.listEntriesByContractDigests([
        "sha256-device-contract",
        "sha256-user-contract",
      ]),
      [
        {
          sessionKey: "device-session-key",
          principalId: "dev_1",
          session: device,
        },
        {
          sessionKey: "user-session-key",
          principalId: "usr_user_1",
          session: user,
        },
      ],
    );
    assertEquals(await sessionRepo.listPage({ limit: 10 }), [
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
      userId: "usr_user_2",
      identity: {
        identityId: "idn_github_user_2",
        provider: "github",
        subject: "user-2",
      },
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
      userId: "usr_user_2",
      identity: {
        identityId: "idn_github_user_2",
        provider: "github",
        subject: "user-2",
      },
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
    assertEquals(await sessionRepo.listPage({ limit: 10 }), [second, service]);

    await sessionRepo.deleteByInstanceKey("svc-session-key");
    assertEquals(await sessionRepo.listPage({ limit: 10 }), [second]);
  });
});

Deno.test("session storage deletes user sessions by canonical user id", async () => {
  await withRepositories(async ({ sessions: sessionRepo }) => {
    const first = makeUserSession({ userId: "usr_user_1" });
    const second = makeUserSession({
      userId: "usr_user_2",
      identity: {
        identityId: "idn_github_user_2",
        provider: "github",
        subject: "user-2",
      },
      contractDigest: "sha256-other-user-contract",
    });
    const service = makeServiceSession();
    await sessionRepo.put("first-user-session-key", first);
    await sessionRepo.put("second-user-session-key", second);
    await sessionRepo.put("service-session-key", service);

    await sessionRepo.deleteByUser("usr_user_1");

    assertEquals(await sessionRepo.listPage({ limit: 10 }), [second, service]);
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

    assertEquals(await sessionRepo.listPage({ limit: 10 }), [second, service]);
  });
});

Deno.test("service deployment storage upserts, deletes, and lists by deployment id", async () => {
  await withRepositories(
    async ({ serviceDeployments: deployments }, storage) => {
      const first = makeServiceDeployment({ deploymentId: "svc-deployment-b" });
      const second = makeServiceDeployment({
        deploymentId: "svc-deployment-a",
        namespaces: [],
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
      });
      await deployments.put(updated);

      assertEquals(await deployments.get("svc-deployment-b"), updated);
      assertEquals(await deployments.listPage({ limit: 10 }), [
        second,
        updated,
      ]);
      assertEquals(
        await deployments.listByDeploymentIds(["svc-deployment-b", "missing"]),
        [updated],
      );
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
    assertEquals(await instances.listPage({ limit: 10 }), [second, updated]);
    assertEquals(
      await instances.listByCurrentContractDigests(["sha256-service-c"]),
      [updated],
    );
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
      });
      await deployments.put(updated);

      assertEquals(await deployments.get("dev-deployment-b"), updated);
      assertEquals(await deployments.listPage({ limit: 10 }), [
        second,
        updated,
      ]);
      assertEquals(
        await deployments.listByDeploymentIds(["dev-deployment-b", "missing"]),
        [updated],
      );
      await deployments.delete("dev-deployment-a");
      assertEquals(await deployments.get("dev-deployment-a"), undefined);
    },
  );
});

Deno.test("device instance storage upserts, deletes, and lists", async () => {
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
    assertEquals(await instances.listPage({ limit: 10 }), [second, updated]);
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

Deno.test("device activation storage upserts, deletes, and lists", async () => {
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
      assertEquals(await activations.listPage({ limit: 10 }), [
        second,
        updated,
      ]);
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
      assertEquals(await reviews.listPage({ limit: 10 }), [second, updated]);
      await reviews.delete("dar_a");
      assertEquals(await reviews.get("dar_a"), undefined);
    },
  );
});
