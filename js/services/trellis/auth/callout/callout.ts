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
import {
  connectionsKV,
  contractApprovalsKV,
  contractsKV,
  deviceActivationsKV,
  deviceProfilesKV,
  instanceGrantPoliciesKV,
  logger,
  natsAuth,
  sessionKV,
  trellis,
  usersKV,
} from "../../bootstrap/globals.ts";
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
  ContractRecord,
  DeviceActivationRecordSchema,
  DeviceProfileSchema,
  NatsAuthRequest,
  NatsConnectOpts,
  Session,
} from "../../state/schemas.ts";
import {
  AuthCalloutClaimsSchema,
  NatsDisconnectEventSchema,
} from "../../state/schemas.ts";
import { resolveSessionPrincipal } from "../session/principal.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import {
  loadServiceInstanceByKey,
  loadServiceProfile,
} from "../admin/service_rpc.ts";

type DeviceActivationRecord =
  & StaticDecode<typeof DeviceActivationRecordSchema>
  & {
    activatedBy?: { origin: string; id: string };
  };
type DeviceProfile = StaticDecode<typeof DeviceProfileSchema>;
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

type DeviceRuntimeGrant = ReturnType<typeof deriveDeviceRuntimeAccess> & {
  activation: {
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    activatedBy?: { origin: string; id: string };
    state: string;
    activatedAt: string | null;
    revokedAt: string | null;
  };
  profile: {
    profileId: string;
    appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
    disabled: boolean;
  };
};

async function findDeviceActivationByIdentityKey(
  publicIdentityKey: string,
): Promise<DeviceActivationRecord | null> {
  const activationEntry =
    await deviceActivationsKV.get(deviceInstanceId(publicIdentityKey)).take();
  if (isErr(activationEntry)) return null;
  const activation = activationEntry.value as DeviceActivationRecord;
  return activation.publicIdentityKey === publicIdentityKey ? activation : null;
}

async function resolveDeviceRuntimeGrant(
  publicIdentityKey: string,
  contractDigest?: string,
  contractStore?: ContractStore,
): Promise<DeviceRuntimeGrant> {
  const activation = await findDeviceActivationByIdentityKey(publicIdentityKey);
  if (!activation) throw new Error("unknown_device");
  if (activation.state !== "activated" || activation.revokedAt !== null) {
    throw new Error("device_activation_revoked");
  }

  const profileEntry = await deviceProfilesKV.get(activation.profileId).take();
  if (isErr(profileEntry)) throw new Error("device_profile_not_found");
  const profile = profileEntry.value as unknown as DeviceProfile;
  if (profile.disabled) throw new Error("device_profile_disabled");

  const effectiveContractDigest = resolveDeviceContractDigest(
    profile,
    contractDigest,
  );
  const activationActor = (activation as DeviceActivationRecord).activatedBy;

  const contractEntry = await contractsKV.get(effectiveContractDigest).take();
  if (isErr(contractEntry)) throw new Error("device_contract_not_found");
  const contractRecord = contractEntry.value as ContractRecord;
  const access = deriveDeviceRuntimeAccess(
    profile,
    contractRecord,
    contractStore,
  );
  return {
    ...access,
    activation: {
      instanceId: activation.instanceId,
      publicIdentityKey: activation.publicIdentityKey,
      profileId: activation.profileId,
      ...(activationActor ? { activatedBy: activationActor } : {}),
      state: activation.state,
      activatedAt: activation.activatedAt,
      revokedAt: activation.revokedAt,
    },
    profile,
  };
}

export function startDisconnectCleanup(): BackgroundTaskHandle {
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

        const keys = await connectionsKV.keys(`>.>.${userNkey}`).take();
        if (isErr(keys)) continue;

        for await (const key of keys) {
          const parts = key.split(".");
          const sessionKey = parts[0];
          const trellisId = parts[1];
          if (!sessionKey || !trellisId) continue;

          const session = await sessionKV.get(`${sessionKey}.${trellisId}`).take();
          if (!isErr(session)) {
            const sessionValue = session.value as Session;
            if (sessionValue.type !== "device") {
              (
                await trellis.publish("Auth.Disconnect", {
                  origin: sessionValue.origin,
                  id: sessionValue.id,
                  sessionKey,
                  userNkey,
                })
              ).inspectErr((error) =>
                logger.warn({ error }, "Failed to publish Auth.Disconnect")
              );
            }
          }

          await connectionsKV.delete(key);
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
  opts?: { contractStore?: ContractStore },
): BackgroundTaskHandle {
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
      const usesIat = typeof authToken.iat === "number";

      if (usesIat) {
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
          const profile = await loadServiceProfile(service.profileId);
          if (!profile || profile.disabled) throw new Error("service_disabled");
        }
      } else {
        throw new Error("invalid_auth_token");
      }

      let sessionKeyId: string | undefined;
      const iter = await sessionKV.keys(`${sessionKey}.>`).take();
      if (!isErr(iter)) {
        const matches: string[] = [];
        for await (const key of iter) matches.push(key);

        if (matches.length > 1) {
          const connIter = await connectionsKV.keys(`${sessionKey}.>.>`).take();
          if (!isErr(connIter)) {
            for await (const key of connIter) {
              const entry = await connectionsKV.get(key).take();
              if (!isErr(entry)) {
                await kick(entry.value.serverId, entry.value.clientId);
              }
              await connectionsKV.delete(key);
            }
          }

          for (const key of matches) {
            await sessionKV.delete(key);
          }
          throw new Error("session_corrupted");
        }

        if (matches.length === 1) sessionKeyId = matches[0];
      }

      if (!sessionKeyId) {
        const service = await loadServiceInstanceByKey(sessionKey);
        let putResult;
        if (service) {
          const profile = await loadServiceProfile(service.profileId);
          const trellisId = await trellisIdFromOriginId("service", sessionKey);
          const displayName = profile?.profileId ?? service.instanceId;
          sessionKeyId = `${sessionKey}.${trellisId}`;
          putResult = await sessionKV.put(sessionKeyId, {
            type: "service",
            trellisId,
            origin: "service",
            id: sessionKey,
            email: `${displayName || "service"}@trellis.internal`,
            name: displayName,
            instanceId: service.instanceId,
            profileId: service.profileId,
            instanceKey: service.instanceKey,
            currentContractId: service.currentContractId ?? null,
            currentContractDigest: service.currentContractDigest ?? null,
            createdAt: now,
            lastAuth: now,
          }).take();
        } else if (usesIat) {
          deviceGrant = await resolveDeviceRuntimeGrant(
            sessionKey,
            authToken.contractDigest,
            opts?.contractStore,
          );
          sessionKeyId = `${sessionKey}.${deviceGrant.activation.instanceId}`;
          // The first successful runtime auth marks when an approved device was
          // actually used, which is distinct from the earlier review timestamp.
          putResult = await sessionKV.put(sessionKeyId, {
            type: "device",
            instanceId: deviceGrant.activation.instanceId,
            publicIdentityKey: deviceGrant.activation.publicIdentityKey,
            profileId: deviceGrant.profile.profileId,
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
          }).take();
        } else {
          throw new Error("session_not_found");
        }
        if (isErr(putResult)) {
          logger.error(
            { error: putResult.error, sessionKeyId },
            "Failed to create service session",
          );
          throw new Error("session_create_failed");
        }
      }

      const sessionEntry = await sessionKV.get(sessionKeyId).take();
      if (isErr(sessionEntry)) throw new Error("session_not_found");
      let session = sessionEntry.value as Session;

      if (session.type === "device") {
        const presentedContractDigest = usesIat
          ? authToken.contractDigest
          : session.contractDigest;
        const currentGrant = deviceGrant ?? await resolveDeviceRuntimeGrant(
          sessionKey,
          presentedContractDigest,
          opts?.contractStore,
        );
        let activatedAt = currentGrant.activation.activatedAt
          ? new Date(currentGrant.activation.activatedAt)
          : null;
        if (activatedAt === null) {
          const activatedAtIso = now.toISOString();
          activatedAt = now;
          await deviceActivationsKV.put(currentGrant.activation.instanceId, {
            ...currentGrant.activation,
            activatedAt: activatedAtIso,
          });
        }

        session = {
          ...session,
          profileId: currentGrant.profile.profileId,
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
      } else if (session.type === "user" && usesIat) {
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
            const entry = await usersKV.get(trellisId).take();
            return isErr(entry) ? null : entry.value;
          },
          loadStoredApproval: async (key) => {
            const entry = await contractApprovalsKV.get(key).take();
            return isErr(entry) ? null : entry.value;
          },
          loadInstanceGrantPolicies: async (contractId) => {
            const entry = await instanceGrantPoliciesKV.get(contractId).take();
            return isErr(entry) ? [] : [entry.value];
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
        loadServiceProfile,
        usersKV: {
          get: (key) => AsyncResult.lift(usersKV.get(key)),
        },
        deviceActivationsKV: {
          get: (key) => AsyncResult.lift(deviceActivationsKV.get(key)),
        },
        deviceProfilesKV: {
          get: (key) => AsyncResult.lift(deviceProfilesKV.get(key)),
        },
        loadStoredApproval: async (key) => {
          const entry = await contractApprovalsKV.get(key).take();
          return isErr(entry) ? null : entry.value;
        },
        loadInstanceGrantPolicies: async (contractId: string) => {
          const entry = await instanceGrantPoliciesKV.get(contractId).take();
          return isErr(entry) ? [] : [entry.value];
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

      await sessionKV.put(sessionKeyId, { ...session, lastAuth: now }).take();

      const serverId = natsReq.server_id?.id ?? serverName;
      const clientId = natsReq.client_info?.id;
      const sessionScope = session.type === "device"
        ? session.instanceId
        : session.trellisId;
      if (serverId && typeof clientId === "number") {
        (
          await connectionsKV.put(`${sessionKey}.${sessionScope}.${userNkey}`, {
            serverId,
            clientId,
            connectedAt: now,
          })
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
              displayName: session.type === "service"
                ? session.name
                : "service",
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
              displayName: session.type === "service"
                ? session.name
                : "service",
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
