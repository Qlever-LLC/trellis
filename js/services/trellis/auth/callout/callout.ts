import { decode, encodeAuthorizationResponse, encodeUser } from "@nats-io/jwt";
import type { Msg } from "@nats-io/nats-core";
import { fromSeed } from "@nats-io/nkeys";
import {
  buildNatsConnectSignaturePayload,
  NatsAuthTokenV1Schema,
  trellisIdFromOriginId,
} from "@qlever-llc/trellis/auth";
import type {
  ContractUses,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { AsyncResult, isErr } from "@qlever-llc/result";
import type { StaticDecode } from "typebox";
import { Value } from "typebox/value";

import { verifyDomainSig } from "../crypto.ts";
import { CalloutLimiter } from "./limiter.ts";
import { buildAuthCalloutPermissions } from "./permissions.ts";
import type { Config } from "../../config.ts";
import {
  type ContractResourceBindings,
  getResourcePermissionGrants,
} from "../../catalog/resources.ts";
import type { ContractsModule } from "../../catalog/runtime.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import {
  computeEnvelopeDelta,
  evaluateEnvelopeFit,
} from "../envelope_decision.ts";
import { resolveUserReconnectSession } from "./user_reconnect.ts";
import {
  getServicePublishSubjectsForContracts,
  getServiceSubscribeSubjectsForContracts,
  getUserPublishSubjectsForContracts,
  getUserSubscribeSubjectsForContracts,
} from "../../catalog/permissions.ts";
import {
  ContractUseDependencyError,
  resolveContractUsesFromEntries,
  validateActiveContractCompatibility,
} from "../../catalog/uses.ts";
import {
  deriveDeviceRuntimeAccess,
  type DeviceRuntimeAccess,
  type DeviceRuntimeAccessDenialReason,
} from "../device_activation/runtime_access.ts";
import type {
  DeviceActivationRecordSchema,
  DeviceDeploymentSchema,
  DeviceSchema,
  ServiceSession,
  Session,
} from "../schemas.ts";
import type {
  AuthCalloutClaims,
  NatsAuthRequest,
  NatsConnectOpts,
} from "../nats_schemas.ts";
import type { EnvelopeBoundary } from "../schemas.ts";
import {
  AuthCalloutClaimsSchema,
  NatsDisconnectEventSchema,
} from "../nats_schemas.ts";
import { resolveSessionPrincipal } from "../session/principal.ts";
import {
  connectionFilterForUserNkey,
  connectionKey,
  parseConnectionKey,
} from "../session/connections.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import type {
  ServiceDeployment as AdminServiceDeployment,
  ServiceInstance as AdminServiceInstance,
} from "../admin/shared.ts";
import type {
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentResourceBindingRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlIdentityEnvelopeRepository,
  SqlImplementationOfferRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";

type DeviceActivationRecord = StaticDecode<typeof DeviceActivationRecordSchema>;
type DeviceDeployment = StaticDecode<typeof DeviceDeploymentSchema>;
type DeviceInstance = StaticDecode<typeof DeviceSchema>;
type ParsedNatsAuthToken = StaticDecode<typeof NatsAuthTokenV1Schema>;
type CalloutContractDeps = Pick<
  ContractsModule,
  | "getActiveEntries"
  | "getContract"
  | "getKnownEntriesByContractId"
  | "getKnownContract"
  | "validateContract"
>;
type RuntimeContractEntry = { digest: string; contract: TrellisContractV1 };
type ServiceRuntimeContract = { contractId: string; contractDigest: string };
type ContractWithUses = TrellisContractV1 & { uses?: ContractUses };
type ContractUseRef = NonNullable<
  NonNullable<ContractUses["optional"]>[string]
>;
type AuthCalloutDenialCode =
  | "auth_token_required"
  | "invalid_auth_token"
  | "unsupported_protocol_version"
  | "missing_session_key"
  | "missing_sig"
  | "iat_out_of_range"
  | "invalid_signature"
  | "unknown_service"
  | "service_disabled"
  | "service_envelope_miss"
  | "unknown_device"
  | "device_activation_revoked"
  | "device_deployment_not_found"
  | "device_deployment_disabled"
  | "device_contract_not_found"
  | "device_envelope_miss"
  | DeviceRuntimeAccessDenialReason
  | "session_not_found"
  | "contract_changed"
  | "approval_required"
  | "user_not_found"
  | "user_inactive"
  | "insufficient_permissions";

type AuthCalloutStageResult<T> =
  | { ok: true; value: T }
  | { ok: false; denial: AuthCalloutDenialCode };

type SerializedErrorDetails = {
  err?: Error;
  errorMessage: string;
  errorName?: string;
};

type DecodedAuthCalloutRequest = {
  serverXkey: string;
  serverName: string;
  serverIdNkey: string;
  userNkey: string;
  natsReq: NatsAuthRequest;
  connectOpts: NatsConnectOpts;
  clientIp?: string;
};

type ValidatedAuthToken = {
  token: ParsedNatsAuthToken;
  sessionKey: string;
};

function stageOk<T>(value: T): AuthCalloutStageResult<T> {
  return { ok: true, value };
}

function stageDeny<T>(
  denial: AuthCalloutDenialCode,
): AuthCalloutStageResult<T> {
  return { ok: false, denial };
}

function serializedErrorDetails(error: unknown): SerializedErrorDetails {
  if (error instanceof Error) {
    return {
      err: error,
      errorMessage: error.message,
      errorName: error.name,
    };
  }
  return { errorMessage: String(error) };
}

const AUTH_CALLOUT_DRAIN_TIMEOUT_MS = 5_000;
const AUTH_CALLOUT_INTERNAL_ERROR = "internal_error";

type AuthCalloutErrorCode =
  | AuthCalloutDenialCode
  | "rate_limited"
  | typeof AUTH_CALLOUT_INTERNAL_ERROR;

type AuthCalloutErrorContext = {
  userNkey?: string;
  serverIdNkey?: string;
  serverXkey?: string;
};

type AuthCalloutErrorResponder = {
  respond(payload: string | Uint8Array): boolean;
};

async function respondAuthCalloutError(args: {
  message: AuthCalloutErrorResponder;
  code: AuthCalloutErrorCode;
  issuerSigningKey: string;
  context: AuthCalloutErrorContext;
  seal(payload: Uint8Array, serverXkey: string): Uint8Array;
}): Promise<void> {
  const { context } = args;
  if (context.userNkey && context.serverIdNkey && context.serverXkey) {
    const response = await encodeAuthorizationResponse(
      context.userNkey,
      context.serverIdNkey,
      args.issuerSigningKey,
      { error: args.code },
      { aud: "trellis" },
    );
    args.message.respond(
      args.seal(new TextEncoder().encode(response), context.serverXkey),
    );
    return;
  }

  args.message.respond("");
}

export type BackgroundTaskHandle = {
  stop: () => Promise<void>;
};

async function waitForInFlightHandlers(
  inFlight: Set<Promise<void>>,
  timeoutMs: number,
): Promise<"drained" | "timed_out"> {
  if (inFlight.size === 0) return "drained";

  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      Promise.allSettled([...inFlight]).then(() => "drained" as const),
      new Promise<"timed_out">((resolve) => {
        timeoutId = setTimeout(() => resolve("timed_out"), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function extractClientIp(natsReq: NatsAuthRequest): string | undefined {
  const clientInfo = natsReq.client_info;
  if (clientInfo) {
    if (typeof clientInfo.ip === "string" && clientInfo.ip.length > 0) {
      return clientInfo.ip;
    }
    if (typeof clientInfo.host === "string" && clientInfo.host.length > 0) {
      return clientInfo.host;
    }
  }
  return undefined;
}

type DeviceRuntimeGrant = DeviceRuntimeAccess & {
  authority: "admin_reviewed" | "user_delegated";
  instance: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
  };
  activation: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    activatedBy?: NonNullable<DeviceActivationRecord["activatedBy"]>;
    state: "activated" | "revoked";
    activatedAt: string | null;
    revokedAt: string | null;
  } | null;
  deployment: {
    deploymentId: string;
    disabled: boolean;
  };
};

type ServiceRuntimeLoaders = {
  loadServiceInstance(
    instanceKey: string,
  ): Promise<AdminServiceInstance | null>;
  loadServiceDeployment(
    deploymentId: string,
  ): Promise<AdminServiceDeployment | null>;
};

function resourceBindingsForPermissions(
  records: Array<
    { kind: string; alias: string; binding: Record<string, unknown> }
  >,
): ContractResourceBindings {
  const resources: ContractResourceBindings = {};
  const resourcesByKind: Record<
    string,
    Record<string, Record<string, unknown>>
  > = {};
  let jobsBinding:
    | {
      namespace: unknown;
      workStream?: unknown;
      queues: Record<string, Record<string, unknown>>;
    }
    | undefined;
  for (const record of records) {
    if (record.kind === "jobs") {
      const { namespace, workStream, ...queueBinding } = record.binding;
      jobsBinding ??= {
        namespace,
        ...(workStream !== undefined ? { workStream } : {}),
        queues: {},
      };
      jobsBinding.queues[record.alias] = queueBinding;
      continue;
    }
    resourcesByKind[record.kind] ??= {};
    resourcesByKind[record.kind][record.alias] = record.binding;
  }
  for (const [kind, bindings] of Object.entries(resourcesByKind)) {
    if (kind === "kv") {
      resources.kv = bindings as ContractResourceBindings["kv"];
    }
    if (kind === "store") {
      resources.store = bindings as ContractResourceBindings["store"];
    }
    if (kind === "event-consumer") {
      resources.eventConsumers =
        bindings as ContractResourceBindings["eventConsumers"];
    }
  }
  if (jobsBinding) {
    resources.jobs = jobsBinding as ContractResourceBindings["jobs"];
  }
  return resources;
}

function serviceCapabilitiesForPermissions(
  staleCapabilities: string[],
  envelope: EnvelopeBoundary | undefined,
): string[] {
  return [
    ...new Set([
      ...staleCapabilities,
      "service",
      ...(envelope?.capabilities ?? []),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

type DeviceRuntimeGrantDeps = {
  deviceInstanceStorage: {
    get(instanceId: string): Promise<DeviceInstance | undefined>;
  };
  deviceActivationStorage: Pick<SqlDeviceActivationRepository, "get" | "put">;
  deviceDeploymentStorage: Pick<SqlDeviceDeploymentRepository, "get">;
  deploymentEnvelopeStorage: Pick<SqlDeploymentEnvelopeRepository, "get">;
};

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function mergeBoundaries(...boundaries: EnvelopeBoundary[]): EnvelopeBoundary {
  return computeEnvelopeDelta(EMPTY_BOUNDARY, {
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

function dependencyContractIds(contract: TrellisContractV1): string[] {
  const ids = new Set<string>();
  for (const group of [contract.uses?.required, contract.uses?.optional]) {
    for (const use of Object.values(group ?? {})) ids.add(use.contract);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function canResolveKnownDependencyEntries(
  entries: RuntimeContractEntry[],
  contract: TrellisContractV1,
): boolean {
  try {
    validateActiveContractCompatibility(entries);
    resolveContractUsesFromEntries(entries, contract);
    return true;
  } catch {
    return false;
  }
}

function searchKnownDependencyEntries(args: {
  contract: TrellisContractV1;
  dependencyIds: string[];
  candidatesByContractId: Map<string, RuntimeContractEntry[]>;
  dependencyIndex: number;
  selected: Map<string, RuntimeContractEntry>;
}): Map<string, RuntimeContractEntry> | null {
  if (
    canResolveKnownDependencyEntries([...args.selected.values()], args.contract)
  ) {
    return args.selected;
  }
  if (args.dependencyIndex >= args.dependencyIds.length) return null;

  const withoutCandidate = searchKnownDependencyEntries({
    ...args,
    dependencyIndex: args.dependencyIndex + 1,
  });
  if (withoutCandidate) return withoutCandidate;

  const contractId = args.dependencyIds[args.dependencyIndex]!;
  for (const candidate of args.candidatesByContractId.get(contractId) ?? []) {
    if (args.selected.has(candidate.digest)) continue;
    const next = new Map(args.selected);
    next.set(candidate.digest, candidate);
    try {
      validateActiveContractCompatibility([...next.values()]);
    } catch {
      continue;
    }
    const resolved = searchKnownDependencyEntries({
      ...args,
      dependencyIndex: args.dependencyIndex + 1,
      selected: next,
    });
    if (resolved) return resolved;
  }
  return null;
}

async function withKnownDependencyEntries(
  contracts: CalloutContractDeps,
  entries: RuntimeContractEntry[],
): Promise<AuthCalloutStageResult<RuntimeContractEntry[]>> {
  const byDigest = new Map(entries.map((entry) => [entry.digest, entry]));
  const pending = [...entries].sort((left, right) =>
    left.digest.localeCompare(right.digest)
  );
  for (const entry of pending) {
    if (
      canResolveKnownDependencyEntries([...byDigest.values()], entry.contract)
    ) {
      continue;
    }

    const dependencyIds = dependencyContractIds(entry.contract);
    const candidatesByContractId = new Map<string, RuntimeContractEntry[]>();
    for (const contractId of dependencyIds) {
      const candidates = (await contracts.getKnownEntriesByContractId(
        contractId,
      )).sort((left, right) => left.digest.localeCompare(right.digest));
      candidatesByContractId.set(contractId, candidates);
    }

    const resolved = searchKnownDependencyEntries({
      contract: entry.contract,
      dependencyIds,
      candidatesByContractId,
      dependencyIndex: 0,
      selected: byDigest,
    });
    if (!resolved) {
      return stageDeny("insufficient_permissions");
    }
    byDigest.clear();
    for (const [digest, selectedEntry] of resolved.entries()) {
      byDigest.set(digest, selectedEntry);
    }
  }
  return stageOk(
    [...byDigest.values()].sort((left, right) =>
      left.digest.localeCompare(right.digest)
    ),
  );
}

function contractWithEnvelopeGrantedOptionalUses(
  contract: TrellisContractV1,
  envelopeBoundary: EnvelopeBoundary | undefined,
): TrellisContractV1 {
  const uses = (contract as ContractWithUses).uses;
  if (!uses?.optional || !envelopeBoundary) return contract;

  const grantedSurfaceNames = (
    use: ContractUseRef,
    kind: "rpc" | "operation" | "event" | "feed",
    action: "call" | "publish" | "subscribe" | "observe" | "cancel",
    names: string[] | undefined,
  ): string[] | undefined => {
    const granted = names?.filter((name) =>
      envelopeBoundary.surfaces.some((surface) =>
        surface.contractId === use.contract &&
        surface.kind === kind &&
        surface.name === name &&
        surface.action === action
      )
    );
    return granted && granted.length > 0 ? granted : undefined;
  };

  const grantedOperationNames = (use: ContractUseRef): string[] | undefined => {
    const names = use.operations?.call;
    const granted = names?.filter((name) =>
      envelopeBoundary.surfaces.some((surface) =>
        surface.contractId === use.contract &&
        surface.kind === "operation" &&
        surface.name === name &&
        (surface.action === "call" ||
          surface.action === "observe" ||
          surface.action === "cancel")
      )
    );
    return granted && granted.length > 0 ? granted : undefined;
  };

  const grantedOptionalUses = Object.fromEntries(
    Object.entries(uses.optional).flatMap(([alias, use]) => {
      const rpcCall = grantedSurfaceNames(
        use,
        "rpc",
        "call",
        use.rpc?.call,
      );
      const operationCall = grantedOperationNames(use);
      const eventPublish = grantedSurfaceNames(
        use,
        "event",
        "publish",
        use.events?.publish,
      );
      const eventSubscribe = grantedSurfaceNames(
        use,
        "event",
        "subscribe",
        use.events?.subscribe,
      );
      const feedSubscribe = grantedSurfaceNames(
        use,
        "feed",
        "subscribe",
        use.feeds?.subscribe,
      );
      const grantedUse: ContractUseRef = {
        contract: use.contract,
        ...(rpcCall ? { rpc: { call: rpcCall } } : {}),
        ...(operationCall ? { operations: { call: operationCall } } : {}),
        ...(eventPublish || eventSubscribe
          ? {
            events: {
              ...(eventPublish ? { publish: eventPublish } : {}),
              ...(eventSubscribe ? { subscribe: eventSubscribe } : {}),
            },
          }
          : {}),
        ...(feedSubscribe ? { feeds: { subscribe: feedSubscribe } } : {}),
      };
      return rpcCall || operationCall || eventPublish || eventSubscribe ||
          feedSubscribe
        ? [[alias, grantedUse]]
        : [];
    }),
  );
  if (Object.keys(grantedOptionalUses).length === 0) return contract;

  const contractWithUses: ContractWithUses = {
    ...contract,
    uses: {
      ...uses,
      required: {
        ...grantedOptionalUses,
        ...uses.required,
      },
    },
  };
  return contractWithUses;
}

async function serviceContractEntriesForPermissions(args: {
  activeContractEntries: RuntimeContractEntry[];
  contracts: CalloutContractDeps;
  contractDigest: string | undefined;
  envelopeBoundary: EnvelopeBoundary | undefined;
}): Promise<AuthCalloutStageResult<RuntimeContractEntry[]>> {
  const digest = args.contractDigest;
  if (!digest) return stageOk(args.activeContractEntries);

  const contract = await args.contracts.getKnownContract(digest);
  if (!contract) return stageOk(args.activeContractEntries);

  const permissionContract = contractWithEnvelopeGrantedOptionalUses(
    contract,
    args.envelopeBoundary,
  );
  const entries = await withKnownDependencyEntries(args.contracts, [
    ...args.activeContractEntries.filter((entry) => entry.digest !== digest),
    { digest, contract: permissionContract },
  ]);
  return entries;
}

function serviceOfferLineageKey(
  deploymentId: string,
  contractId: string,
): string {
  return JSON.stringify(["service", deploymentId, contractId]);
}

function isTrellisContractV1(value: unknown): value is TrellisContractV1 {
  return typeof value === "object" && value !== null &&
    "format" in value && value.format === "trellis.contract.v1" &&
    "id" in value && typeof value.id === "string" &&
    "kind" in value && typeof value.kind === "string";
}

async function findDeviceInstanceByIdentityKey(
  deps: Pick<DeviceRuntimeGrantDeps, "deviceInstanceStorage">,
  publicIdentityKey: string,
): Promise<DeviceInstance | null> {
  const instance = await deps.deviceInstanceStorage.get(
    deviceInstanceId(publicIdentityKey),
  );
  if (!instance) return null;
  return instance.publicIdentityKey === publicIdentityKey ? instance : null;
}

async function findDeviceActivationByIdentityKey(
  deps: Pick<DeviceRuntimeGrantDeps, "deviceActivationStorage">,
  publicIdentityKey: string,
): Promise<DeviceActivationRecord | null> {
  const activation = await deps.deviceActivationStorage.get(
    deviceInstanceId(publicIdentityKey),
  );
  if (!activation) return null;
  return activation.publicIdentityKey === publicIdentityKey ? activation : null;
}

async function resolveDeviceRuntimeGrant(
  deps: DeviceRuntimeGrantDeps,
  publicIdentityKey: string,
  contractStorage: Pick<SqlContractStorageRepository, "get">,
  contractDigest: string | undefined,
  contracts: CalloutContractDeps,
): Promise<AuthCalloutStageResult<DeviceRuntimeGrant>> {
  const instance = await findDeviceInstanceByIdentityKey(
    deps,
    publicIdentityKey,
  );
  if (!instance) return stageDeny("unknown_device");
  if (instance.state === "disabled" || instance.state === "revoked") {
    return stageDeny("unknown_device");
  }

  const activation = await findDeviceActivationByIdentityKey(
    deps,
    publicIdentityKey,
  );
  if (
    activation &&
    (activation.state !== "activated" || activation.revokedAt !== null)
  ) {
    return stageDeny("device_activation_revoked");
  }
  if (
    activation &&
    (activation.publicIdentityKey !== instance.publicIdentityKey ||
      activation.deploymentId !== instance.deploymentId)
  ) {
    return stageDeny("device_activation_revoked");
  }
  if (!activation && instance.state !== "registered") {
    return stageDeny("unknown_device");
  }

  const deployment = await deps.deviceDeploymentStorage.get(
    activation?.deploymentId ?? instance.deploymentId,
  );
  if (!deployment) return stageDeny("device_deployment_not_found");
  if (deployment.disabled) return stageDeny("device_deployment_disabled");

  if (typeof contractDigest !== "string" || contractDigest.length === 0) {
    return stageDeny("invalid_auth_token");
  }
  const activationActor = activation
    ? (activation as DeviceActivationRecord).activatedBy
    : undefined;

  const contractRecord = await contractStorage.get(contractDigest);
  if (!contractRecord) return stageDeny("device_contract_not_found");
  const envelope = await deps.deploymentEnvelopeStorage.get(
    deployment.deploymentId,
  );
  if (!envelope || envelope.disabled) {
    return stageDeny("device_deployment_disabled");
  }
  const contract = JSON.parse(contractRecord.contract);
  const analysis = await analyzeContractEnvelopeBoundary(
    contracts,
    contract,
    { dependencyResolution: "known" },
  );
  const requestedBoundary = mergeBoundaries(
    analysis.required,
    analysis.contributedAvailability,
  );
  const fit = evaluateEnvelopeFit(envelope.boundary, requestedBoundary);
  if (!fit.fits) return stageDeny("device_envelope_miss");
  const accessResult = await deriveDeviceRuntimeAccess(
    contractRecord,
    contracts,
    envelope.boundary,
  );
  if (!accessResult.ok) return stageDeny(accessResult.reason);
  return stageOk({
    ...accessResult.value,
    authority: activation ? "user_delegated" : "admin_reviewed",
    instance: {
      instanceId: instance.instanceId,
      publicIdentityKey: instance.publicIdentityKey,
      deploymentId: instance.deploymentId,
      state: instance.state,
    },
    activation: activation
      ? {
        instanceId: activation.instanceId,
        publicIdentityKey: activation.publicIdentityKey,
        deploymentId: activation.deploymentId,
        ...(activationActor ? { activatedBy: activationActor } : {}),
        state: activation.state,
        activatedAt: activation.activatedAt,
        revokedAt: activation.revokedAt,
      }
      : null,
    deployment,
  });
}

async function verifyRuntimeAuthTokenSignature(input: {
  sessionKey: string;
  iat: number;
  contractDigest: string;
  sig: string;
}): Promise<boolean> {
  return await verifyDomainSig(
    input.sessionKey,
    "nats-connect",
    buildNatsConnectSignaturePayload(input.iat, input.contractDigest),
    input.sig,
  );
}

async function validateServiceRuntimeDigest(args: {
  presentedContractDigest?: string;
  service: Pick<
    AdminServiceInstance,
    | "deploymentId"
    | "instanceId"
  >;
  deployment: Pick<
    AdminServiceDeployment,
    "deploymentId" | "contractCompatibilityMode"
  >;
  contractStorage: Pick<SqlContractStorageRepository, "get">;
  implementationOfferStorage: Pick<
    SqlImplementationOfferRepository,
    "listActiveByDigests" | "put"
  >;
  contracts: CalloutContractDeps;
  deploymentEnvelopeStorage: Pick<SqlDeploymentEnvelopeRepository, "get">;
  now: Date;
}): Promise<AuthCalloutStageResult<ServiceRuntimeContract>> {
  const presentedContractDigest = args.presentedContractDigest;
  if (
    typeof presentedContractDigest !== "string" ||
    presentedContractDigest.length === 0
  ) {
    return stageDeny("invalid_auth_token");
  }

  const activeOffers = await args.implementationOfferStorage
    .listActiveByDigests([presentedContractDigest], args.now);
  const matchingOffer = activeOffers.find((offer) =>
    offer.deploymentKind === "service" &&
    offer.deploymentId === args.deployment.deploymentId &&
    offer.instanceId === args.service.instanceId &&
    offer.contractDigest === presentedContractDigest &&
    offer.status === "accepted" &&
    offer.staleAt === null
  );
  if (!matchingOffer) return stageDeny("contract_changed");

  const contractRecord = await args.contractStorage.get(
    presentedContractDigest,
  );
  let contract: TrellisContractV1;
  if (contractRecord) {
    if (contractRecord.id !== matchingOffer.contractId) {
      return stageDeny("contract_changed");
    }
    const validated = await args.contracts.validateContract(
      JSON.parse(contractRecord.contract),
    );
    if (!isTrellisContractV1(validated.contract)) {
      return stageDeny("contract_changed");
    }
    contract = validated.contract;
  } else {
    const knownContract = await args.contracts.getKnownContract(
      presentedContractDigest,
    );
    if (!knownContract) {
      return stageDeny("contract_changed");
    }
    if (knownContract.id !== matchingOffer.contractId) {
      return stageDeny("contract_changed");
    }
    contract = knownContract;
  }
  const envelope = await args.deploymentEnvelopeStorage.get(
    args.deployment.deploymentId,
  );
  if (!envelope || envelope.disabled) {
    return stageDeny("service_envelope_miss");
  }

  const activeContractEntries = await args.contracts.getActiveEntries();
  const runtimeContractEntries = await withKnownDependencyEntries(
    args.contracts,
    [
      ...activeContractEntries.filter((entry) =>
        entry.digest !== presentedContractDigest
      ),
      { digest: presentedContractDigest, contract },
    ],
  );
  if (!runtimeContractEntries.ok) return runtimeContractEntries;

  let analysis: Awaited<ReturnType<typeof analyzeContractEnvelopeBoundary>>;
  try {
    analysis = await analyzeContractEnvelopeBoundary(
      {
        ...args.contracts,
        getActiveEntries: () => Promise.resolve(runtimeContractEntries.value),
      },
      contract,
      { dependencyResolution: "active" },
    );
  } catch (error) {
    if (error instanceof ContractUseDependencyError) {
      return stageDeny("service_envelope_miss");
    }
    throw error;
  }
  const requestedBoundary = mergeBoundaries(
    analysis.required,
    analysis.contributedAvailability,
  );
  const fit = evaluateEnvelopeFit(envelope.boundary, requestedBoundary);
  if (!fit.fits) return stageDeny("service_envelope_miss");
  await args.implementationOfferStorage.put({
    ...matchingOffer,
    lineageKey: serviceOfferLineageKey(
      args.deployment.deploymentId,
      matchingOffer.contractId,
    ),
    liveness: "healthy",
    lastRefreshedAt: args.now.toISOString(),
    staleAt: null,
  });

  return stageOk({
    contractId: analysis.contract.id,
    contractDigest: presentedContractDigest,
  });
}

function refreshServiceSessionFromInstance(args: {
  session: ServiceSession;
  service: AdminServiceInstance;
  deployment: AdminServiceDeployment | null;
  contract?: ServiceRuntimeContract | null;
  now: Date;
}): ServiceSession {
  return {
    ...args.session,
    name: args.deployment?.deploymentId ?? args.service.instanceId,
    instanceId: args.service.instanceId,
    deploymentId: args.service.deploymentId,
    instanceKey: args.service.instanceKey,
    contractId: args.contract?.contractId ?? args.session.contractId,
    contractDigest: args.contract?.contractDigest ??
      args.session.contractDigest,
    lastAuth: args.now,
  };
}

export function startDisconnectCleanup(deps: {
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  envelopeExpansionRequestStorage: Pick<
    SqlEnvelopeExpansionRequestRepository,
    "deletePendingServiceRequestsByRequesterInstanceId"
  >;
  logger: AuthRuntimeDeps["logger"];
  natsSystem: AuthRuntimeDeps["natsSystem"];
  sessionStorage: AuthRuntimeDeps["sessionStorage"];
  implementationOfferStorage: Pick<
    SqlImplementationOfferRepository,
    "listByInstance" | "put"
  >;
  offerStaleGraceMs: number;
  trellis: AuthRuntimeDeps["trellis"];
}): BackgroundTaskHandle {
  const {
    connectionsKV,
    envelopeExpansionRequestStorage,
    logger,
    implementationOfferStorage,
    natsSystem,
    offerStaleGraceMs,
    sessionStorage,
    trellis,
  } = deps;
  const disconnectSub = natsSystem.subscribe("$SYS.ACCOUNT.*.DISCONNECT");
  let stopping = false;
  const task = (async () => {
    try {
      for await (const message of disconnectSub) {
        await processDisconnectMessage({
          connectionsKV,
          envelopeExpansionRequestStorage,
          logger,
          implementationOfferStorage,
          message,
          offerStaleGraceMs,
          sessionStorage,
          trellis,
        });
      }
    } catch (error) {
      if (!stopping) {
        logger.error(
          serializedErrorDetails(error),
          "Disconnect cleanup loop stopped unexpectedly",
        );
      }
    }
  })();

  return {
    async stop() {
      stopping = true;
      disconnectSub.unsubscribe();
      await task;
    },
  };
}

async function processDisconnectMessage(deps: {
  connectionsKV: Pick<AuthRuntimeDeps["connectionsKV"], "delete" | "keys">;
  envelopeExpansionRequestStorage: Pick<
    SqlEnvelopeExpansionRequestRepository,
    "deletePendingServiceRequestsByRequesterInstanceId"
  >;
  logger: AuthRuntimeDeps["logger"];
  implementationOfferStorage: Pick<
    SqlImplementationOfferRepository,
    "listByInstance" | "put"
  >;
  message: { subject: string; string(): string };
  now?: Date;
  offerStaleGraceMs: number;
  sessionStorage: Pick<
    AuthRuntimeDeps["sessionStorage"],
    "getOneBySessionKey"
  >;
  trellis: Pick<AuthRuntimeDeps["trellis"], "event">;
}): Promise<void> {
  const {
    connectionsKV,
    envelopeExpansionRequestStorage,
    implementationOfferStorage,
    logger,
    message,
    offerStaleGraceMs,
    sessionStorage,
    trellis,
  } = deps;
  let data: { client?: { user_nkey?: string } };
  try {
    data = Value.Parse(
      NatsDisconnectEventSchema,
      JSON.parse(message.string()),
    );
  } catch {
    return;
  }

  const userNkey = data.client?.user_nkey;
  logger.trace(
    { event: "NatsDisconnect", subject: message.subject, userNkey },
    "Processing NATS disconnect",
  );
  if (typeof userNkey !== "string" || userNkey.length === 0) return;

  const keys = await connectionsKV.keys(
    connectionFilterForUserNkey(userNkey),
  ).take();
  if (isErr(keys)) return;

  for await (const key of keys) {
    const parsedKey = parseConnectionKey(key);
    if (!parsedKey) {
      logger.warn(
        { key },
        "Skipping unparsable disconnect connection key",
      );
      continue;
    }
    if (parsedKey.userNkey !== userNkey) continue;

    const sessionValue = await sessionStorage.getOneBySessionKey(
      parsedKey.sessionKey,
    );
    if (sessionValue) {
      if (sessionValue.type !== "device") {
        (
          await trellis.event.auth.connectionsClosed.publish({
            origin: sessionValue.type === "user"
              ? sessionValue.identity.provider
              : sessionValue.origin,
            id: sessionValue.type === "user"
              ? sessionValue.identity.subject
              : sessionValue.id,
            sessionKey: parsedKey.sessionKey,
            userNkey,
          })
        ).inspectErr((error: unknown) =>
          logger.warn(
            { error },
            "Failed to publish Auth.Connections.Closed",
          )
        );
      }

      if (sessionValue.type === "service") {
        await envelopeExpansionRequestStorage
          .deletePendingServiceRequestsByRequesterInstanceId(
            sessionValue.instanceId,
          );
        const now = deps.now ?? new Date();
        const staleAt = new Date(now.getTime() + offerStaleGraceMs)
          .toISOString();
        for (
          const offer of await implementationOfferStorage.listByInstance(
            sessionValue.instanceId,
          )
        ) {
          if (offer.status !== "accepted" || offer.staleAt !== null) continue;
          await implementationOfferStorage.put({
            ...offer,
            liveness: "disconnected",
            lastRefreshedAt: now.toISOString(),
            staleAt,
          });
        }
      }
    }

    (await connectionsKV.delete(key)).inspectErr((error: unknown) =>
      logger.warn(
        { error, key },
        "Failed to delete disconnect connection",
      )
    );
  }
}

export function startAuthCallout(
  opts: {
    contractStorage: SqlContractStorageRepository;
    capabilityGroupStorage?: AuthRuntimeDeps["capabilityGroupStorage"];
    userStorage: SqlUserProjectionRepository;
    contractApprovalStorage: SqlIdentityEnvelopeRepository;
    deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
    deploymentResourceBindingStorage?: SqlDeploymentResourceBindingRepository;
    implementationOfferStorage: SqlImplementationOfferRepository;
    connectionsKV: AuthRuntimeDeps["connectionsKV"];
    deviceActivationStorage: AuthRuntimeDeps["deviceActivationStorage"];
    deviceDeploymentStorage: AuthRuntimeDeps["deviceDeploymentStorage"];
    deviceInstanceStorage: AuthRuntimeDeps["deviceInstanceStorage"];
    logger: AuthRuntimeDeps["logger"];
    natsAuth: AuthRuntimeDeps["natsAuth"];
    sessionStorage: AuthRuntimeDeps["sessionStorage"];
    trellis: AuthRuntimeDeps["trellis"];
    loadServiceInstanceByKey: ServiceRuntimeLoaders["loadServiceInstance"];
    loadServiceDeployment: ServiceRuntimeLoaders["loadServiceDeployment"];
    contracts: CalloutContractDeps;
    config: Config;
  },
): BackgroundTaskHandle {
  const {
    config,
    connectionsKV,
    deploymentEnvelopeStorage,
    deploymentResourceBindingStorage,
    implementationOfferStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    logger,
    natsAuth,
    sessionStorage,
    trellis,
    loadServiceInstanceByKey,
    loadServiceDeployment,
  } = opts;
  const xkp = fromSeed(
    new TextEncoder().encode(config.nats.authCallout.sxSeed),
  );
  const sub = natsAuth.subscribe("$SYS.REQ.USER.AUTH", { queue: "trellis" });
  const calloutLimiter = new CalloutLimiter({
    maxConcurrent: 32,
    maxQueue: 256,
    maxConcurrentPerIp: 8,
    maxConcurrentPerServer: 16,
  });

  function decodeAuthCalloutRequest(
    message: Msg,
  ): DecodedAuthCalloutRequest {
    const serverXkey = message.headers?.get("Nats-Server-Xkey");
    if (!serverXkey) {
      throw new Error("Missing Nats-Server-Xkey in authorization request");
    }
    if (!message.data) {
      throw new Error("No data in authorization request");
    }

    const decrypted = xkp.open(message.data, serverXkey);
    if (!decrypted) {
      throw new Error("Authorization request XKey decrypt failed!");
    }

    const claims = Value.Parse(
      AuthCalloutClaimsSchema,
      decode(new TextDecoder().decode(decrypted)),
    ) as AuthCalloutClaims;
    const natsReq = claims.nats;
    if (!natsReq) {
      throw new Error("Missing nats payload in authorization request");
    }

    const userNkey = natsReq.user_nkey;
    if (!userNkey) {
      throw new Error("Missing user_nkey in auth request");
    }

    const serverIdNkey = natsReq.server_id?.id;
    if (!serverIdNkey) {
      throw new Error("Missing server_id.id in auth request");
    }

    const serverName = natsReq.server_id?.name ?? serverIdNkey;
    return {
      serverXkey,
      serverName,
      serverIdNkey,
      userNkey,
      natsReq,
      connectOpts: natsReq.connect_opts ?? {},
      clientIp: extractClientIp(natsReq),
    };
  }

  async function validateAuthToken(
    rawAuthToken: string | undefined,
    now: Date,
  ): Promise<AuthCalloutStageResult<ValidatedAuthToken>> {
    if (!rawAuthToken) return stageDeny("auth_token_required");

    let authToken: ParsedNatsAuthToken;
    try {
      authToken = Value.Parse(
        NatsAuthTokenV1Schema,
        JSON.parse(rawAuthToken),
      ) as ParsedNatsAuthToken;
    } catch {
      return stageDeny("invalid_auth_token");
    }

    if (authToken.v !== 1) {
      return stageDeny("unsupported_protocol_version");
    }

    const sessionKey = authToken.sessionKey;
    const sig = authToken.sig;
    if (typeof sessionKey !== "string" || sessionKey.length === 0) {
      return stageDeny("missing_session_key");
    }
    if (typeof sig !== "string" || sig.length === 0) {
      return stageDeny("missing_sig");
    }

    const iat = authToken.iat;
    if (typeof iat !== "number") return stageDeny("invalid_auth_token");
    const contractDigest = authToken.contractDigest;
    if (typeof contractDigest !== "string" || contractDigest.length === 0) {
      return stageDeny("invalid_auth_token");
    }
    const nowSec = Math.floor(now.getTime() / 1000);
    if (Math.abs(nowSec - iat) > 30) {
      return stageDeny("iat_out_of_range");
    }
    if (
      !await verifyRuntimeAuthTokenSignature({
        sessionKey,
        iat,
        contractDigest,
        sig,
      })
    ) {
      return stageDeny("invalid_signature");
    }

    return stageOk({ token: authToken, sessionKey });
  }

  async function resolveCalloutSession(
    auth: ValidatedAuthToken,
    now: Date,
  ): Promise<AuthCalloutStageResult<Session>> {
    const { sessionKey, token: authToken } = auth;
    const service = await loadServiceInstanceByKey(sessionKey);
    let serviceDeployment: AdminServiceDeployment | null = null;
    let serviceRuntimeContract: ServiceRuntimeContract | null = null;
    if (service) {
      if (service.disabled) return stageDeny("service_disabled");
      serviceDeployment = await loadServiceDeployment(service.deploymentId);
      if (!serviceDeployment || serviceDeployment.disabled) {
        return stageDeny("service_disabled");
      }
      const digestCheck = await validateServiceRuntimeDigest({
        presentedContractDigest: authToken.contractDigest,
        service,
        deployment: serviceDeployment,
        contractStorage: opts.contractStorage,
        contracts: opts.contracts,
        deploymentEnvelopeStorage,
        implementationOfferStorage,
        now,
      });
      if (!digestCheck.ok) return digestCheck;
      serviceRuntimeContract = digestCheck.value;
    }

    let session = await sessionStorage.getOneBySessionKey(sessionKey);
    if (!session) {
      if (service) {
        const trellisId = await trellisIdFromOriginId("service", sessionKey);
        const displayName = serviceDeployment?.deploymentId ??
          service.instanceId;
        await sessionStorage.put(sessionKey, {
          type: "service",
          trellisId,
          origin: "service",
          id: sessionKey,
          email: `${displayName || "service"}@trellis.internal`,
          name: displayName,
          instanceId: service.instanceId,
          deploymentId: service.deploymentId,
          instanceKey: service.instanceKey,
          contractId: serviceRuntimeContract?.contractId ?? null,
          contractDigest: serviceRuntimeContract?.contractDigest ?? null,
          createdAt: now,
          lastAuth: now,
        });
      } else {
        const deviceGrantResult = await resolveDeviceRuntimeGrant(
          {
            deviceActivationStorage,
            deviceDeploymentStorage,
            deviceInstanceStorage,
            deploymentEnvelopeStorage,
          },
          sessionKey,
          opts.contractStorage,
          authToken.contractDigest,
          opts.contracts,
        );
        if (!deviceGrantResult.ok) return deviceGrantResult;
        const deviceGrant = deviceGrantResult.value;
        // Device session creation marks runtime use; activation timestamps remain
        // activation-time metadata and are not created for device-owned authority.
        await sessionStorage.put(sessionKey, {
          type: "device",
          instanceId: deviceGrant.instance.instanceId,
          publicIdentityKey: deviceGrant.instance.publicIdentityKey,
          deploymentId: deviceGrant.deployment.deploymentId,
          contractId: deviceGrant.contractId,
          contractDigest: deviceGrant.contractDigest,
          delegatedCapabilities: deviceGrant.capabilities,
          delegatedPublishSubjects: deviceGrant.publishSubjects,
          delegatedSubscribeSubjects: deviceGrant.subscribeSubjects,
          createdAt: now,
          lastAuth: now,
          activatedAt: deviceGrant.activation?.activatedAt
            ? new Date(deviceGrant.activation.activatedAt)
            : null,
          revokedAt: deviceGrant.activation?.revokedAt
            ? new Date(deviceGrant.activation.revokedAt)
            : null,
        });
      }
      session = await sessionStorage.getOneBySessionKey(sessionKey);
    }

    if (!session) return stageDeny("session_not_found");

    if (session.type === "device") {
      const currentGrantResult = await resolveDeviceRuntimeGrant(
        {
          deviceActivationStorage,
          deviceDeploymentStorage,
          deviceInstanceStorage,
          deploymentEnvelopeStorage,
        },
        sessionKey,
        opts.contractStorage,
        authToken.contractDigest,
        opts.contracts,
      );
      if (!currentGrantResult.ok) return currentGrantResult;
      const currentGrant = currentGrantResult.value;
      let activatedAt = currentGrant.activation?.activatedAt
        ? new Date(currentGrant.activation.activatedAt)
        : null;
      if (activatedAt === null && currentGrant.activation) {
        const activatedAtIso = now.toISOString();
        activatedAt = now;
        await deviceActivationStorage.put({
          ...currentGrant.activation,
          activatedAt: activatedAtIso,
        });
      }

      return stageOk({
        ...session,
        deploymentId: currentGrant.deployment.deploymentId,
        contractId: currentGrant.contractId,
        contractDigest: currentGrant.contractDigest,
        delegatedCapabilities: currentGrant.capabilities,
        delegatedPublishSubjects: currentGrant.publishSubjects,
        delegatedSubscribeSubjects: currentGrant.subscribeSubjects,
        lastAuth: now,
        activatedAt,
        revokedAt: currentGrant.activation?.revokedAt
          ? new Date(currentGrant.activation.revokedAt)
          : null,
      });
    }

    if (session.type === "user") {
      if (
        typeof authToken.contractDigest !== "string" ||
        authToken.contractDigest.length === 0
      ) {
        return stageDeny("invalid_auth_token");
      }

      const resolvedReconnect = await resolveUserReconnectSession({
        session,
        presentedContractDigest: authToken.contractDigest,
        contracts: opts.contracts,
        loadUserProjection: async (trellisId) => {
          return await opts.userStorage.get(trellisId) ?? null;
        },
        capabilityGroupStorage: opts.capabilityGroupStorage,
      });
      if (!resolvedReconnect.ok) {
        return stageDeny(resolvedReconnect.reason);
      }
      return stageOk({
        ...resolvedReconnect.session,
        lastAuth: now,
      });
    }

    if (session.type === "service" && service) {
      return stageOk(refreshServiceSessionFromInstance({
        session,
        service,
        deployment: serviceDeployment,
        contract: serviceRuntimeContract,
        now,
      }));
    }

    return stageOk(session);
  }

  async function issuePrincipalPermissions(
    session: Session,
    sessionKey: string,
    userNkey: string,
    serverIdNkey: string,
  ): Promise<AuthCalloutStageResult<string>> {
    let resourcePermissions = {
      publish: [] as string[],
      subscribe: [] as string[],
    };
    const principal = await resolveSessionPrincipal(session, sessionKey, {
      loadServiceInstance: loadServiceInstanceByKey,
      loadServiceDeployment,
      loadUserProjection: async (trellisId) => {
        return await opts.userStorage.get(trellisId) ?? null;
      },
      capabilityGroupStorage: opts.capabilityGroupStorage,
      deviceActivationStorage,
      deviceInstanceStorage,
      deviceDeploymentStorage,
    });
    if (!principal.ok) {
      return stageDeny(principal.error.reason);
    }

    const isService = session.type === "service";
    const serviceEnvelope = principal.value.serviceState
      ? await deploymentEnvelopeStorage.get(
        principal.value.serviceState.deploymentId,
      )
      : undefined;
    if (isService && (!serviceEnvelope || serviceEnvelope.disabled)) {
      return stageDeny("service_envelope_miss");
    }
    if (principal.value.serviceState) {
      const deploymentBindings = deploymentResourceBindingStorage
        ? resourceBindingsForPermissions(
          await deploymentResourceBindingStorage.listByDeployment(
            principal.value.serviceState.deploymentId,
          ),
        )
        : principal.value.serviceState.resourceBindings as
          | ContractResourceBindings
          | undefined;
      resourcePermissions = getResourcePermissionGrants(deploymentBindings);
    }
    const effectiveCapabilities = isService
      ? serviceCapabilitiesForPermissions(
        principal.value.capabilities,
        serviceEnvelope?.boundary,
      )
      : principal.value.capabilities;

    const inboxPrefix = `_INBOX.${sessionKey.slice(0, 16)}`;
    const activeContractEntries = await opts.contracts.getActiveEntries();
    const serviceContractEntries = isService
      ? await serviceContractEntriesForPermissions({
        activeContractEntries,
        contracts: opts.contracts,
        contractDigest: session.type === "service"
          ? session.contractDigest ?? undefined
          : undefined,
        envelopeBoundary: serviceEnvelope?.boundary,
      })
      : stageOk(activeContractEntries);
    if (!serviceContractEntries.ok) return serviceContractEntries;
    const userContractEntries =
      session.type === "user" && session.identityEnvelope
        ? await (async () => {
          const contract = await opts.contracts.getKnownContract(
            session.contractDigest,
          );
          if (!contract) return activeContractEntries;
          const entries = await withKnownDependencyEntries(opts.contracts, [
            ...activeContractEntries.filter((entry) =>
              entry.digest !== session.contractDigest
            ),
            { digest: session.contractDigest, contract },
          ]);
          return entries.ok ? entries.value : entries;
        })()
        : [];
    if (!Array.isArray(userContractEntries)) return userContractEntries;
    const userAllowedPublishSubjects =
      session.type === "user" && session.identityEnvelope
        ? getUserPublishSubjectsForContracts(
          session.delegatedCapabilities,
          {
            contractDigest: session.contractDigest,
            identityEnvelope: session.identityEnvelope,
          },
          userContractEntries,
        )
        : [];
    const userAllowedSubscribeSubjects =
      session.type === "user" && session.identityEnvelope
        ? getUserSubscribeSubjectsForContracts(
          session.delegatedCapabilities,
          {
            contractDigest: session.contractDigest,
            identityEnvelope: session.identityEnvelope,
          },
          userContractEntries,
        )
        : [];
    const delegatedPublish = session.type === "user" && session.identityEnvelope
      ? session.delegatedPublishSubjects.filter((subject) =>
        userAllowedPublishSubjects.includes(subject)
      )
      : session.type === "service"
      ? []
      : session.delegatedPublishSubjects!;
    const delegatedSubscribe =
      session.type === "user" && session.identityEnvelope
        ? session.delegatedSubscribeSubjects.filter((subject) =>
          userAllowedSubscribeSubjects.includes(subject)
        )
        : session.type === "service"
        ? []
        : session.delegatedSubscribeSubjects!;
    const permissions = buildAuthCalloutPermissions({
      publishAllow: [
        ...(isService
          ? getServicePublishSubjectsForContracts(
            effectiveCapabilities,
            {
              sessionKey,
              contractDigest: session.type === "service"
                ? session.contractDigest ?? undefined
                : undefined,
              envelopeBoundary: serviceEnvelope?.boundary,
            },
            serviceContractEntries.value,
          )
          : delegatedPublish),
        ...resourcePermissions.publish,
      ],
      subscribeAllow: isService
        ? [
          ...getServiceSubscribeSubjectsForContracts(
            effectiveCapabilities,
            {
              sessionKey,
              contractDigest: session.type === "service"
                ? session.contractDigest ?? undefined
                : undefined,
              envelopeBoundary: serviceEnvelope?.boundary,
            },
            serviceContractEntries.value,
          ),
          ...resourcePermissions.subscribe,
        ]
        : delegatedSubscribe,
      inboxPrefix,
      issuerAccount: config.nats.authCallout.target.nkey,
      sessionType: session.type,
    });
    logger.debug({ permissions }, "issuing permissions");

    const userJwtExp = Math.floor((Date.now() + config.ttlMs.natsJwt) / 1000);
    const userJwt = await encodeUser(
      principal.value.email,
      userNkey,
      config.nats.authCallout.target.signing,
      permissions,
      { aud: "trellis", exp: userJwtExp },
    );

    return stageOk(
      await encodeAuthorizationResponse(
        userNkey,
        serverIdNkey,
        config.nats.authCallout.issuer.signing,
        {
          jwt: userJwt,
          issuer_account: config.nats.authCallout.issuer.nkey,
        },
        { aud: "trellis" },
      ),
    );
  }

  async function handleAuthCallout(message: Msg): Promise<void> {
    logger.trace(
      { event: "AuthCallout", subject: message.subject },
      "Processing auth callout",
    );

    let limiterRelease: (() => void) | null = null;
    let serverXkey: string | undefined;
    let userNkey: string | undefined;
    let serverName: string | undefined;
    let serverIdNkey: string | undefined;

    async function deny(code: AuthCalloutDenialCode): Promise<void> {
      logger.warn(
        {
          denial: code,
          serverName,
          userNkey: userNkey ? `${userNkey.substring(0, 8)}...` : undefined,
        },
        "Auth callout denied",
      );
      await respondAuthCalloutError({
        message,
        code,
        issuerSigningKey: config.nats.authCallout.issuer.signing,
        context: { userNkey, serverIdNkey, serverXkey },
        seal: (payload, responseServerXkey) =>
          xkp.seal(payload, responseServerXkey),
      });
      limiterRelease?.();
      limiterRelease = null;
    }

    try {
      const decoded = decodeAuthCalloutRequest(message);
      serverXkey = decoded.serverXkey;
      userNkey = decoded.userNkey;
      serverIdNkey = decoded.serverIdNkey;
      serverName = decoded.serverName;

      limiterRelease = await calloutLimiter.acquire({
        ip: decoded.clientIp,
        server: decoded.serverName,
      });
      if (!limiterRelease) {
        await respondAuthCalloutError({
          message,
          code: "rate_limited",
          issuerSigningKey: config.nats.authCallout.issuer.signing,
          context: {
            userNkey: decoded.userNkey,
            serverIdNkey: decoded.serverIdNkey,
            serverXkey: decoded.serverXkey,
          },
          seal: (payload, responseServerXkey) =>
            xkp.seal(payload, responseServerXkey),
        });
        return;
      }

      const now = new Date();
      const validatedToken = await validateAuthToken(
        decoded.connectOpts.auth_token,
        now,
      );
      if (!validatedToken.ok) return await deny(validatedToken.denial);

      const { sessionKey } = validatedToken.value;

      logger.debug(
        {
          serverName: decoded.serverName,
          clientIp: decoded.clientIp,
          userNkey: `${decoded.userNkey.substring(0, 8)}...`,
          sessionKey: `${sessionKey.substring(0, 8)}...`,
        },
        "Auth callout received",
      );

      const resolvedSession = await resolveCalloutSession(
        validatedToken.value,
        now,
      );
      if (!resolvedSession.ok) return await deny(resolvedSession.denial);
      const session = resolvedSession.value;

      const issued = await issuePrincipalPermissions(
        session,
        sessionKey,
        decoded.userNkey,
        decoded.serverIdNkey,
      );
      if (!issued.ok) return await deny(issued.denial);

      await sessionStorage.put(sessionKey, { ...session, lastAuth: now });

      const serverId = decoded.natsReq.server_id?.id ?? decoded.serverName;
      const clientId = decoded.natsReq.client_info?.id;
      const sessionScope = session.type === "device"
        ? session.instanceId
        : session.type === "user"
        ? session.userId
        : session.trellisId;
      if (serverId && typeof clientId === "number") {
        (
          await connectionsKV.put(
            connectionKey(sessionKey, sessionScope, userNkey),
            {
              serverId,
              clientId,
              connectedAt: now,
            },
          )
        ).inspectErr((error: unknown) =>
          logger.warn({ error }, "Failed to track connection")
        );
      }

      if (session.type !== "device") {
        (
          await trellis.event.auth.connectionsOpened.publish({
            origin: session.type === "user"
              ? session.identity.provider
              : session.origin,
            id: session.type === "user" ? session.identity.subject : session.id,
            sessionKey,
            userNkey: decoded.userNkey,
          })
        ).inspectErr((error: unknown) =>
          logger.warn({ error }, "Failed to publish Auth.Connections.Opened")
        );
      }

      message.respond(
        xkp.seal(new TextEncoder().encode(issued.value), decoded.serverXkey),
      );
    } catch (error) {
      logger.error(
        {
          ...serializedErrorDetails(error),
          serverName,
          userNkey: userNkey ? `${userNkey.substring(0, 8)}...` : undefined,
        },
        "Auth callout failed unexpectedly",
      );

      const respondResult = await AsyncResult.try(async () => {
        await respondAuthCalloutError({
          message,
          code: AUTH_CALLOUT_INTERNAL_ERROR,
          issuerSigningKey: config.nats.authCallout.issuer.signing,
          context: { userNkey, serverIdNkey, serverXkey },
          seal: (payload, responseServerXkey) =>
            xkp.seal(payload, responseServerXkey),
        });
      });
      if (respondResult.isErr()) {
        logger.error(
          serializedErrorDetails(respondResult.error),
          "Failed to respond to auth callout error",
        );
      }
    }

    limiterRelease?.();
  }

  let stopping = false;
  const inFlight = new Set<Promise<void>>();

  function trackAuthCallout(message: Msg): void {
    const handler = handleAuthCallout(message)
      .catch((error) => {
        logger.error(
          serializedErrorDetails(error),
          "Auth callout handler failed unexpectedly",
        );
      })
      .finally(() => {
        inFlight.delete(handler);
      });
    inFlight.add(handler);
  }

  const task = (async () => {
    try {
      for await (const message of sub) {
        trackAuthCallout(message);
      }
    } catch (error) {
      if (!stopping) {
        logger.error(
          serializedErrorDetails(error),
          "Auth callout loop stopped unexpectedly",
        );
      }
    }
  })();

  return {
    async stop() {
      stopping = true;
      sub.unsubscribe();
      await task;
      const pendingCount = inFlight.size;
      const drainResult = await waitForInFlightHandlers(
        inFlight,
        AUTH_CALLOUT_DRAIN_TIMEOUT_MS,
      );
      if (drainResult === "timed_out") {
        logger.warn(
          { pendingCount, timeoutMs: AUTH_CALLOUT_DRAIN_TIMEOUT_MS },
          "Timed out waiting for auth callout handlers to finish",
        );
      }
    },
  };
}

export const __testing__ = {
  AUTH_CALLOUT_INTERNAL_ERROR,
  respondAuthCalloutError,
  processDisconnectMessage,
  resolveDeviceRuntimeGrant,
  refreshServiceSessionFromInstance,
  resourceBindingsForPermissions,
  serviceCapabilitiesForPermissions,
  serviceContractEntriesForPermissions,
  validateServiceRuntimeDigest,
  verifyRuntimeAuthTokenSignature,
  waitForInFlightHandlers,
  withKnownDependencyEntries,
};
