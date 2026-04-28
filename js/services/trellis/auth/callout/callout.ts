import { decode, encodeAuthorizationResponse, encodeUser } from "@nats-io/jwt";
import type { Msg } from "@nats-io/nats-core";
import { fromSeed } from "@nats-io/nkeys";
import {
  buildNatsConnectSignaturePayload,
  NatsAuthTokenV1Schema,
  trellisIdFromOriginId,
} from "@qlever-llc/trellis/auth";
import { AsyncResult, isErr } from "@qlever-llc/result";
import type { StaticDecode } from "typebox";
import { Value } from "typebox/value";

import { verifyDomainSig } from "../crypto.ts";
import { CalloutLimiter } from "./limiter.ts";
import { buildAuthCalloutPermissions } from "./permissions.ts";
import type { Config } from "../../config.ts";
import { getResourcePermissionGrants } from "../../catalog/resources.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import { resolveUserReconnectSession } from "./user_reconnect.ts";
import {
  getServicePublishSubjects,
  getServiceSubscribeSubjects,
} from "../../catalog/permissions.ts";
import {
  deriveDeviceRuntimeAccess,
  type DeviceRuntimeAccess,
  type DeviceRuntimeAccessDenialReason,
  resolveDeviceContractDigest,
} from "../device_activation/runtime_access.ts";
import type {
  Connection,
  DeviceActivationRecordSchema,
  DeviceDeploymentSchema,
  Session,
} from "../schemas.ts";
import type {
  AuthCalloutClaims,
  NatsAuthRequest,
  NatsConnectOpts,
} from "../nats_schemas.ts";
import {
  AuthCalloutClaimsSchema,
  NatsDisconnectEventSchema,
} from "../nats_schemas.ts";
import { resolveSessionPrincipal } from "../session/principal.ts";
import {
  connectionFilterForSession,
  connectionFilterForUserNkey,
  connectionKey,
  parseConnectionKey,
} from "../session/connections.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import type {
  ServiceDeployment as AdminServiceDeployment,
  ServiceInstance as AdminServiceInstance,
} from "../admin/shared.ts";
import { parseContractApprovalKey } from "../http/support.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";

type DeviceActivationRecord =
  & StaticDecode<typeof DeviceActivationRecordSchema>
  & {
    activatedBy?: { origin: string; id: string };
  };
type DeviceDeployment = StaticDecode<typeof DeviceDeploymentSchema>;
type ParsedNatsAuthToken = StaticDecode<typeof NatsAuthTokenV1Schema>;
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
  | "unknown_device"
  | "device_activation_revoked"
  | "device_deployment_not_found"
  | "device_deployment_disabled"
  | "device_contract_not_found"
  | DeviceRuntimeAccessDenialReason
  | "session_not_found"
  | "contract_changed"
  | "approval_required"
  | "user_not_found"
  | "user_inactive"
  | "insufficient_permissions"
  | "service_role_on_user";

type AuthCalloutStageResult<T> =
  | { ok: true; value: T }
  | { ok: false; denial: AuthCalloutDenialCode };

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
  activation: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    activatedBy?: { origin: string; id: string };
    state: "activated" | "revoked";
    activatedAt: string | null;
    revokedAt: string | null;
  };
  deployment: {
    deploymentId: string;
    appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
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
  loadInstanceGrantPolicies: Required<
    Pick<
      Parameters<typeof resolveSessionPrincipal>[2],
      "loadInstanceGrantPolicies"
    >
  >["loadInstanceGrantPolicies"];
};

type DeviceRuntimeGrantDeps = {
  deviceActivationStorage: Pick<SqlDeviceActivationRepository, "get" | "put">;
  deviceDeploymentStorage: Pick<SqlDeviceDeploymentRepository, "get">;
};

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
  contractStorage: SqlContractStorageRepository,
  contractDigest?: string,
  contractStore?: ContractStore,
): Promise<AuthCalloutStageResult<DeviceRuntimeGrant>> {
  const activation = await findDeviceActivationByIdentityKey(
    deps,
    publicIdentityKey,
  );
  if (!activation) return stageDeny("unknown_device");
  if (activation.state !== "activated" || activation.revokedAt !== null) {
    return stageDeny("device_activation_revoked");
  }

  const deployment = await deps.deviceDeploymentStorage.get(
    activation.deploymentId,
  );
  if (!deployment) return stageDeny("device_deployment_not_found");
  if (deployment.disabled) return stageDeny("device_deployment_disabled");

  const digestResult = resolveDeviceContractDigest(
    deployment,
    contractDigest,
  );
  if (!digestResult.ok) return stageDeny(digestResult.reason);
  const activationActor = (activation as DeviceActivationRecord).activatedBy;

  const contractRecord = await contractStorage.get(digestResult.value);
  if (!contractRecord) return stageDeny("device_contract_not_found");
  const accessResult = deriveDeviceRuntimeAccess(
    deployment,
    contractRecord,
    contractStore,
  );
  if (!accessResult.ok) return stageDeny(accessResult.reason);
  return stageOk({
    ...accessResult.value,
    activation: {
      instanceId: activation.instanceId,
      publicIdentityKey: activation.publicIdentityKey,
      deploymentId: activation.deploymentId,
      ...(activationActor ? { activatedBy: activationActor } : {}),
      state: activation.state,
      activatedAt: activation.activatedAt,
      revokedAt: activation.revokedAt,
    },
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

function validateServiceRuntimeDigest(args: {
  presentedContractDigest?: string;
  service: Pick<
    AdminServiceInstance,
    "currentContractId" | "currentContractDigest"
  >;
  deployment: Pick<AdminServiceDeployment, "appliedContracts">;
}): AuthCalloutStageResult<void> {
  if (
    typeof args.presentedContractDigest !== "string" ||
    args.presentedContractDigest.length === 0
  ) {
    return stageDeny("invalid_auth_token");
  }

  const currentContractDigest = args.service.currentContractDigest;
  const currentContractId = args.service.currentContractId;
  if (
    typeof currentContractDigest !== "string" ||
    currentContractDigest.length === 0 ||
    typeof currentContractId !== "string" ||
    currentContractId.length === 0 ||
    args.presentedContractDigest !== currentContractDigest
  ) {
    return stageDeny("contract_changed");
  }

  const appliedContract = args.deployment.appliedContracts.find((entry) =>
    entry.contractId === currentContractId
  );
  if (!appliedContract?.allowedDigests.includes(args.presentedContractDigest)) {
    return stageDeny("contract_changed");
  }

  return stageOk(undefined);
}

export function startDisconnectCleanup(deps: {
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  logger: AuthRuntimeDeps["logger"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  sessionStorage: AuthRuntimeDeps["sessionStorage"];
  trellis: AuthRuntimeDeps["trellis"];
}): BackgroundTaskHandle {
  const { connectionsKV, logger, natsAuth, sessionStorage, trellis } = deps;
  const disconnectSub = natsAuth.subscribe("$SYS.ACCOUNT.*.DISCONNECT");
  let stopping = false;
  const task = (async () => {
    try {
      for await (const message of disconnectSub) {
        let data: { client?: { user_nkey?: string } };
        try {
          data = Value.Parse(
            NatsDisconnectEventSchema,
            JSON.parse(message.string()),
          ) as {
            client?: { user_nkey?: string };
          };
        } catch {
          continue;
        }

        const userNkey = data.client?.user_nkey;
        logger.trace(
          { event: "NatsDisconnect", subject: message.subject, userNkey },
          "Processing NATS disconnect",
        );
        if (typeof userNkey !== "string" || userNkey.length === 0) continue;

        const keys = await connectionsKV.keys(
          connectionFilterForUserNkey(userNkey),
        ).take();
        if (isErr(keys)) continue;

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
                await trellis.publish("Auth.Disconnect", {
                  origin: sessionValue.origin,
                  id: sessionValue.id,
                  sessionKey: parsedKey.sessionKey,
                  userNkey,
                })
              ).inspectErr((error: unknown) =>
                logger.warn({ error }, "Failed to publish Auth.Disconnect")
              );
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
    } catch (error) {
      if (!stopping) {
        logger.error({ error }, "Disconnect cleanup loop stopped unexpectedly");
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

export function startAuthCallout(
  opts: {
    contractStorage: SqlContractStorageRepository;
    userStorage: SqlUserProjectionRepository;
    contractApprovalStorage: SqlContractApprovalRepository;
    connectionsKV: AuthRuntimeDeps["connectionsKV"];
    deviceActivationStorage: AuthRuntimeDeps["deviceActivationStorage"];
    deviceDeploymentStorage: AuthRuntimeDeps["deviceDeploymentStorage"];
    logger: AuthRuntimeDeps["logger"];
    natsAuth: AuthRuntimeDeps["natsAuth"];
    sessionStorage: AuthRuntimeDeps["sessionStorage"];
    trellis: AuthRuntimeDeps["trellis"];
    loadServiceInstanceByKey: ServiceRuntimeLoaders["loadServiceInstance"];
    loadServiceDeployment: ServiceRuntimeLoaders["loadServiceDeployment"];
    loadInstanceGrantPolicies:
      ServiceRuntimeLoaders["loadInstanceGrantPolicies"];
    contractStore?: ContractStore;
    config: Config;
  },
): BackgroundTaskHandle {
  const {
    config,
    connectionsKV,
    deviceActivationStorage,
    deviceDeploymentStorage,
    logger,
    natsAuth,
    sessionStorage,
    trellis,
    loadServiceInstanceByKey,
    loadServiceDeployment,
    loadInstanceGrantPolicies,
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
    if (service) {
      if (service.disabled) return stageDeny("service_disabled");
      serviceDeployment = await loadServiceDeployment(service.deploymentId);
      if (!serviceDeployment || serviceDeployment.disabled) {
        return stageDeny("service_disabled");
      }
      const digestCheck = validateServiceRuntimeDigest({
        presentedContractDigest: authToken.contractDigest,
        service,
        deployment: serviceDeployment,
      });
      if (!digestCheck.ok) return digestCheck;
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
          currentContractId: service.currentContractId ?? null,
          currentContractDigest: service.currentContractDigest ?? null,
          createdAt: now,
          lastAuth: now,
        });
      } else {
        const deviceGrantResult = await resolveDeviceRuntimeGrant(
          { deviceActivationStorage, deviceDeploymentStorage },
          sessionKey,
          opts.contractStorage,
          authToken.contractDigest,
          opts.contractStore,
        );
        if (!deviceGrantResult.ok) return deviceGrantResult;
        const deviceGrant = deviceGrantResult.value;
        // The first successful runtime auth marks when an approved device was
        // actually used, which is distinct from the earlier review timestamp.
        await sessionStorage.put(sessionKey, {
          type: "device",
          instanceId: deviceGrant.activation.instanceId,
          publicIdentityKey: deviceGrant.activation.publicIdentityKey,
          deploymentId: deviceGrant.deployment.deploymentId,
          contractId: deviceGrant.contractId,
          contractDigest: deviceGrant.contractDigest,
          delegatedCapabilities: deviceGrant.capabilities,
          delegatedPublishSubjects: deviceGrant.publishSubjects,
          delegatedSubscribeSubjects: deviceGrant.subscribeSubjects,
          createdAt: now,
          lastAuth: now,
          activatedAt: deviceGrant.activation.activatedAt
            ? new Date(deviceGrant.activation.activatedAt)
            : null,
          revokedAt: deviceGrant.activation.revokedAt
            ? new Date(deviceGrant.activation.revokedAt)
            : null,
        });
      }
      session = await sessionStorage.getOneBySessionKey(sessionKey);
    }

    if (!session) return stageDeny("session_not_found");

    if (session.type === "device") {
      const currentGrantResult = await resolveDeviceRuntimeGrant(
        { deviceActivationStorage, deviceDeploymentStorage },
        sessionKey,
        opts.contractStorage,
        authToken.contractDigest,
        opts.contractStore,
      );
      if (!currentGrantResult.ok) return currentGrantResult;
      const currentGrant = currentGrantResult.value;
      let activatedAt = currentGrant.activation.activatedAt
        ? new Date(currentGrant.activation.activatedAt)
        : null;
      if (activatedAt === null) {
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
        revokedAt: currentGrant.activation.revokedAt
          ? new Date(currentGrant.activation.revokedAt)
          : null,
      });
    }

    if (session.type === "user") {
      if (!opts?.contractStore) return stageDeny("contract_changed");
      if (
        typeof authToken.contractDigest !== "string" ||
        authToken.contractDigest.length === 0
      ) {
        return stageDeny("invalid_auth_token");
      }

      const resolvedReconnect = await resolveUserReconnectSession({
        session,
        presentedContractDigest: authToken.contractDigest,
        contractStore: opts.contractStore,
        loadUserProjection: async (trellisId) => {
          return await opts.userStorage.get(trellisId) ?? null;
        },
        loadStoredApproval: async (key) => {
          const approvalKey = parseContractApprovalKey(key);
          if (!approvalKey) return null;
          return await opts.contractApprovalStorage.get(
            approvalKey.userTrellisId,
            approvalKey.contractDigest,
          ) ?? null;
        },
        loadInstanceGrantPolicies: async (contractId) => {
          return await loadInstanceGrantPolicies(contractId);
        },
      });
      if (!resolvedReconnect.ok) {
        return stageDeny(resolvedReconnect.reason);
      }
      return stageOk({
        ...resolvedReconnect.session,
        lastAuth: now,
      });
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
      deviceActivationStorage,
      deviceDeploymentStorage,
      loadStoredApproval: async (key) => {
        const approvalKey = parseContractApprovalKey(key);
        if (!approvalKey) return null;
        return await opts.contractApprovalStorage.get(
          approvalKey.userTrellisId,
          approvalKey.contractDigest,
        ) ?? null;
      },
      loadInstanceGrantPolicies: async (contractId: string) => {
        return await loadInstanceGrantPolicies(contractId);
      },
    });
    if (!principal.ok) {
      return stageDeny(principal.error.reason);
    }

    if (principal.value.serviceState) {
      resourcePermissions = getResourcePermissionGrants(
        principal.value.serviceState.resourceBindings,
      );
    }

    const inboxPrefix = `_INBOX.${sessionKey.slice(0, 16)}`;
    const isService = session.type === "service";
    const delegatedPublish = session.type === "service"
      ? []
      : session.delegatedPublishSubjects!;
    const delegatedSubscribe = session.type === "service"
      ? []
      : session.delegatedSubscribeSubjects!;
    const permissions = buildAuthCalloutPermissions({
      publishAllow: [
        ...(isService
          ? getServicePublishSubjects(principal.value.capabilities, {
            sessionKey,
            contractDigest: principal.value.serviceState?.currentContractDigest,
          })
          : delegatedPublish),
        ...resourcePermissions.publish,
      ],
      subscribeAllow: isService
        ? [
          ...getServiceSubscribeSubjects(principal.value.capabilities, {
            sessionKey,
            contractDigest: principal.value.serviceState?.currentContractDigest,
          }),
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
          await trellis.publish("Auth.Connect", {
            origin: session.origin,
            id: session.id,
            sessionKey,
            userNkey: decoded.userNkey,
          })
        ).inspectErr((error: unknown) =>
          logger.warn({ error }, "Failed to publish Auth.Connect")
        );
      }

      message.respond(
        xkp.seal(new TextEncoder().encode(issued.value), decoded.serverXkey),
      );
    } catch (error) {
      logger.error(
        {
          error,
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
          { error: respondResult.error },
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
        logger.error({ error }, "Auth callout handler failed unexpectedly");
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
        logger.error({ error }, "Auth callout loop stopped unexpectedly");
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
  validateServiceRuntimeDigest,
  verifyRuntimeAuthTokenSignature,
  waitForInFlightHandlers,
};
