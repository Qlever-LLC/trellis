import { decode, encodeAuthorizationResponse, encodeUser } from "@nats-io/jwt";
import type { Msg } from "@nats-io/nats-core";
import { fromSeed } from "@nats-io/nkeys";
import {
  NatsAuthTokenV1Schema,
  trellisIdFromOriginId,
} from "@qlever-llc/trellis/auth";
import { AsyncResult, isErr } from "@qlever-llc/result";
import type { StaticDecode } from "typebox";
import { Value } from "typebox/value";

import { verifyDomainSig } from "../crypto.ts";
import { CalloutLimiter } from "./limiter.ts";
import { buildAuthCalloutPermissions } from "./permissions.ts";
import { getConfig } from "../../config.ts";
import { getResourcePermissionGrants } from "../../catalog/resources.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { authRuntimeDeps } from "../runtime_deps.ts";
import { kick } from "./kick.ts";
import { resolveUserReconnectSession } from "./user_reconnect.ts";
import {
  getServicePublishSubjects,
  getServiceSubscribeSubjects,
} from "../../catalog/permissions.ts";
import {
  deriveDeviceRuntimeAccess,
  resolveDeviceContractDigest,
} from "../device_activation/runtime_access.ts";
import type {
  AuthCalloutClaims,
  Connection,
  DeviceActivationRecordSchema,
  DeviceDeploymentSchema,
  NatsAuthRequest,
  NatsConnectOpts,
  Session,
} from "../../state/schemas.ts";
import {
  AuthCalloutClaimsSchema,
  NatsDisconnectEventSchema,
} from "../../state/schemas.ts";
import { resolveSessionPrincipal } from "../session/principal.ts";
import {
  connectionFilterForSession,
  connectionFilterForUserNkey,
  connectionKey,
  parseConnectionKey,
} from "../session/connections.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { loadEffectiveGrantPolicies } from "../grants/store.ts";
import {
  loadServiceDeployment,
  loadServiceInstanceByKey,
} from "../admin/service_rpc.ts";
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

const config = getConfig();
export type BackgroundTaskHandle = {
  stop: () => Promise<void>;
};

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

function parseContractApprovalKey(
  key: string,
): { userTrellisId: string; contractDigest: string } | null {
  const separator = key.lastIndexOf(".");
  if (separator <= 0 || separator >= key.length - 1) return null;
  return {
    userTrellisId: key.slice(0, separator),
    contractDigest: key.slice(separator + 1),
  };
}

type DeviceRuntimeGrant = ReturnType<typeof deriveDeviceRuntimeAccess> & {
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

async function findDeviceActivationByIdentityKey(
  publicIdentityKey: string,
): Promise<DeviceActivationRecord | null> {
  const { deviceActivationStorage } = authRuntimeDeps();
  const activation = await deviceActivationStorage.get(
    deviceInstanceId(publicIdentityKey),
  );
  if (!activation) return null;
  return activation.publicIdentityKey === publicIdentityKey ? activation : null;
}

async function resolveDeviceRuntimeGrant(
  publicIdentityKey: string,
  contractStorage: SqlContractStorageRepository,
  contractDigest?: string,
  contractStore?: ContractStore,
): Promise<DeviceRuntimeGrant> {
  const activation = await findDeviceActivationByIdentityKey(publicIdentityKey);
  if (!activation) throw new Error("unknown_device");
  if (activation.state !== "activated" || activation.revokedAt !== null) {
    throw new Error("device_activation_revoked");
  }

  const { deviceDeploymentStorage } = authRuntimeDeps();
  const deployment = await deviceDeploymentStorage.get(activation.deploymentId);
  if (!deployment) throw new Error("device_deployment_not_found");
  if (deployment.disabled) throw new Error("device_deployment_disabled");

  const effectiveContractDigest = resolveDeviceContractDigest(
    deployment,
    contractDigest,
  );
  const activationActor = (activation as DeviceActivationRecord).activatedBy;

  const contractRecord = await contractStorage.get(effectiveContractDigest);
  if (!contractRecord) throw new Error("device_contract_not_found");
  const access = deriveDeviceRuntimeAccess(
    deployment,
    contractRecord,
    contractStore,
  );
  return {
    ...access,
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
  };
}

export function startDisconnectCleanup(): BackgroundTaskHandle {
  const { connectionsKV, logger, natsAuth, sessionStorage, trellis } =
    authRuntimeDeps();
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
              ).inspectErr((error) =>
                logger.warn({ error }, "Failed to publish Auth.Disconnect")
              );
            }
          }

          (await connectionsKV.delete(key)).inspectErr((error) =>
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
    contractStore?: ContractStore;
  },
): BackgroundTaskHandle {
  const {
    connectionsKV,
    deviceActivationStorage,
    deviceDeploymentStorage,
    logger,
    natsAuth,
    sessionStorage,
    trellis,
  } = authRuntimeDeps();
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

    try {
      serverXkey = message.headers?.get("Nats-Server-Xkey");
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

      userNkey = natsReq.user_nkey;
      if (!userNkey) {
        throw new Error("Missing user_nkey in auth request");
      }

      serverIdNkey = natsReq.server_id?.id;
      if (!serverIdNkey) {
        throw new Error("Missing server_id.id in auth request");
      }
      serverName = natsReq.server_id?.name ?? serverIdNkey;

      const connectOpts: NatsConnectOpts = natsReq.connect_opts ?? {};
      const clientIp = extractClientIp(natsReq);

      limiterRelease = await calloutLimiter.acquire({
        ip: clientIp,
        server: serverName,
      });
      if (!limiterRelease) {
        const response = await encodeAuthorizationResponse(
          userNkey,
          serverIdNkey,
          config.nats.authCallout.issuer.signing,
          { error: "rate_limited" },
          { aud: "trellis" },
        );
        message.respond(
          xkp.seal(new TextEncoder().encode(response), serverXkey),
        );
        return;
      }

      const rawAuthToken = connectOpts.auth_token;
      if (!rawAuthToken) throw new Error("auth_token required");

      let authToken: ParsedNatsAuthToken;
      try {
        authToken = Value.Parse(
          NatsAuthTokenV1Schema,
          JSON.parse(rawAuthToken),
        ) as ParsedNatsAuthToken;
      } catch {
        throw new Error("invalid_auth_token");
      }

      if (authToken.v !== 1) throw new Error("unsupported_protocol_version");

      const sessionKey = authToken.sessionKey;
      const sig = authToken.sig;

      logger.debug(
        {
          serverName,
          clientIp,
          userNkey: `${userNkey.substring(0, 8)}...`,
          sessionKey: `${sessionKey.substring(0, 8)}...`,
        },
        "Auth callout received",
      );

      const now = new Date();
      if (typeof sessionKey !== "string" || sessionKey.length === 0) {
        throw new Error("missing_session_key");
      }
      if (typeof sig !== "string" || sig.length === 0) {
        throw new Error("missing_sig");
      }

      let deviceGrant: DeviceRuntimeGrant | null = null;
      const iat = authToken.iat;
      if (typeof iat !== "number") throw new Error("invalid_auth_token");
      const nowSec = Math.floor(now.getTime() / 1000);
      if (Math.abs(nowSec - iat) > 30) throw new Error("iat_out_of_range");
      if (
        !(await verifyDomainSig(sessionKey, "nats-connect", String(iat), sig))
      ) {
        throw new Error("invalid_signature");
      }

      const service = await loadServiceInstanceByKey(sessionKey);
      if (service) {
        if (service.disabled) throw new Error("service_disabled");
        const deployment = await loadServiceDeployment(service.deploymentId);
        if (!deployment || deployment.disabled) {
          throw new Error("service_disabled");
        }
      }

      let session = await sessionStorage.getOneBySessionKey(sessionKey);
      if (!session) {
        const service = await loadServiceInstanceByKey(sessionKey);
        if (service) {
          const deployment = await loadServiceDeployment(service.deploymentId);
          const trellisId = await trellisIdFromOriginId("service", sessionKey);
          const displayName = deployment?.deploymentId ?? service.instanceId;
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
          deviceGrant = await resolveDeviceRuntimeGrant(
            sessionKey,
            opts.contractStorage,
            authToken.contractDigest,
            opts.contractStore,
          );
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

      if (!session) throw new Error("session_not_found");

      if (session.type === "device") {
        const currentGrant = deviceGrant ?? await resolveDeviceRuntimeGrant(
          sessionKey,
          opts.contractStorage,
          authToken.contractDigest,
          opts.contractStore,
        );
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

        session = {
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
        };
      } else if (session.type === "user") {
        if (!opts?.contractStore) {
          throw new Error("contract_changed");
        }
        if (
          typeof authToken.contractDigest !== "string" ||
          authToken.contractDigest.length === 0
        ) {
          throw new Error("invalid_auth_token");
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
            return await loadEffectiveGrantPolicies(contractId);
          },
        });
        if (!resolvedReconnect.ok) {
          throw new Error(resolvedReconnect.reason);
        }
        session = {
          ...resolvedReconnect.session,
          lastAuth: now,
        };
      }

      const inboxPrefix = `_INBOX.${sessionKey.slice(0, 16)}`;
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
          return await loadEffectiveGrantPolicies(contractId);
        },
      });
      if (!principal.ok) {
        throw new Error(principal.error.reason);
      }

      if (principal.value.serviceState) {
        resourcePermissions = getResourcePermissionGrants(
          principal.value.serviceState.resourceBindings,
        );
      }

      await sessionStorage.put(sessionKey, { ...session, lastAuth: now });

      const serverId = natsReq.server_id?.id ?? serverName;
      const clientId = natsReq.client_info?.id;
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
        ).inspectErr((error) =>
          logger.warn({ error }, "Failed to track connection")
        );
      }

      if (session.type !== "device") {
        (
          await trellis.publish("Auth.Connect", {
            origin: session.origin,
            id: session.id,
            sessionKey,
            userNkey,
          })
        ).inspectErr((error) =>
          logger.warn({ error }, "Failed to publish Auth.Connect")
        );
      }

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
              contractDigest: principal.value.serviceState
                ?.currentContractDigest,
            })
            : delegatedPublish),
          ...resourcePermissions.publish,
        ],
        subscribeAllow: isService
          ? [
            ...getServiceSubscribeSubjects(principal.value.capabilities, {
              sessionKey,
              contractDigest: principal.value.serviceState
                ?.currentContractDigest,
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

      const response = await encodeAuthorizationResponse(
        userNkey,
        serverIdNkey,
        config.nats.authCallout.issuer.signing,
        {
          jwt: userJwt,
          issuer_account: config.nats.authCallout.issuer.nkey,
        },
        { aud: "trellis" },
      );

      message.respond(xkp.seal(new TextEncoder().encode(response), serverXkey));
    } catch (error) {
      const messageText = error instanceof Error
        ? error.message
        : "Unknown error";
      logger.error(
        {
          err: error,
          serverName,
          userNkey: userNkey ? `${userNkey.substring(0, 8)}...` : undefined,
        },
        messageText,
      );

      const respondResult = await AsyncResult.try(async () => {
        if (userNkey && serverIdNkey && serverXkey) {
          const response = await encodeAuthorizationResponse(
            userNkey,
            serverIdNkey,
            config.nats.authCallout.issuer.signing,
            { error: messageText },
            { aud: "trellis" },
          );
          message.respond(
            xkp.seal(new TextEncoder().encode(response), serverXkey),
          );
        } else {
          message.respond("");
        }
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
  const task = (async () => {
    try {
      for await (const message of sub) {
        void handleAuthCallout(message);
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
    },
  };
}
