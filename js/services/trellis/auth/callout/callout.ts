import { decode, encodeAuthorizationResponse, encodeUser, type User } from "@nats-io/jwt";
import type { Msg } from "@nats-io/nats-core";
import { fromSeed } from "@nats-io/nkeys";
import { NatsAuthTokenV1Schema, trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { AsyncResult, isErr } from "@qlever-llc/result";
import type { StaticDecode } from "typebox";
import { Value } from "typebox/value";

import { hashKey, randomToken, verifyDomainSig } from "../crypto.ts";
import { CalloutLimiter } from "./limiter.ts";
import { getConfig } from "../../config.ts";
import { getResourcePermissionGrants } from "../../catalog/resources.ts";
import type { ContractStore } from "../../catalog/store.ts";
import { CONTRACT as trellisAuthContract } from "../../contracts/trellis_auth.ts";
import {
  bindingTokenKV,
  connectionsKV,
  contractsKV,
  logger,
  natsAuth,
  servicesKV,
  sessionKV,
  trellis,
  usersKV,
  workloadActivationsKV,
  workloadProfilesKV,
} from "../../bootstrap/globals.ts";
import { kick } from "./kick.ts";
import {
  getServicePublishSubjects,
  getServiceSubscribeSubjects,
} from "../../catalog/permissions.ts";
import {
  deriveWorkloadRuntimeAccess,
  resolveWorkloadContractDigest,
} from "../workload_activation/runtime_access.ts";
import type {
  AuthCalloutClaims,
  Connection,
  ContractRecord,
  NatsAuthRequest,
  NatsConnectOpts,
  ServiceRegistryEntry,
  Session,
  WorkloadActivationRecordSchema,
  WorkloadProfileSchema,
} from "../../state/schemas.ts";
import {
  AuthCalloutClaimsSchema,
  NatsDisconnectEventSchema,
} from "../../state/schemas.ts";
import { resolveSessionPrincipal } from "../session/principal.ts";
import {
  workloadActivationRecordKey,
} from "../workload_activation/keys.ts";
import { workloadInstanceId } from "../admin/shared.ts";

type WorkloadActivationRecord = StaticDecode<typeof WorkloadActivationRecordSchema> & {
  activatedBy?: { origin: string; id: string };
};
type WorkloadProfile = StaticDecode<typeof WorkloadProfileSchema>;
type ParsedNatsAuthToken = StaticDecode<typeof NatsAuthTokenV1Schema> & {
  contractDigest?: string;
};

const config = getConfig();
const AUTH_RENEW_SUBJECT = trellisAuthContract.rpc?.["Auth.RenewBindingToken"]?.subject;

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

type WorkloadRuntimeGrant = ReturnType<typeof deriveWorkloadRuntimeAccess> & {
  activation: {
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    activatedBy?: { origin: string; id: string };
    state: string;
    activatedAt: string | null;
    revokedAt: string | null;
  };
  profile: { profileId: string; contractId: string; allowedDigests: string[]; disabled: boolean };
};

async function findWorkloadActivationByIdentityKey(
  publicIdentityKey: string,
): Promise<WorkloadActivationRecord | null> {
  const activationEntry = (await workloadActivationsKV.get(workloadInstanceId(publicIdentityKey))).take();
  if (isErr(activationEntry)) return null;
  const activation = activationEntry.value as WorkloadActivationRecord;
  return activation.publicIdentityKey === publicIdentityKey ? activation : null;
}

async function resolveWorkloadRuntimeGrant(
  publicIdentityKey: string,
  contractDigest?: string,
  contractStore?: ContractStore,
): Promise<WorkloadRuntimeGrant> {
  const activation = await findWorkloadActivationByIdentityKey(publicIdentityKey);
  if (!activation) throw new Error("unknown_workload");
  if (activation.state !== "activated" || activation.revokedAt !== null) {
    throw new Error("workload_activation_revoked");
  }

  const profileEntry = (await workloadProfilesKV.get(activation.profileId)).take();
  if (isErr(profileEntry)) throw new Error("workload_profile_not_found");
  const profile = profileEntry.value as WorkloadProfile;
  if (profile.disabled) throw new Error("workload_profile_disabled");

  const effectiveContractDigest = resolveWorkloadContractDigest(profile, contractDigest);
  const activationActor = (activation as WorkloadActivationRecord).activatedBy;

      const contractEntry = (await contractsKV.get(effectiveContractDigest)).take();
      if (isErr(contractEntry)) throw new Error("workload_contract_not_found");
  const contractRecord = contractEntry.value as ContractRecord;
  const access = deriveWorkloadRuntimeAccess(profile, contractRecord, contractStore);
  return { ...access, activation: {
    instanceId: activation.instanceId,
    publicIdentityKey: activation.publicIdentityKey,
    profileId: activation.profileId,
    ...(activationActor ? { activatedBy: activationActor } : {}),
    state: activation.state,
    activatedAt: activation.activatedAt,
    revokedAt: activation.revokedAt,
  }, profile };
}

export function startDisconnectCleanup(): BackgroundTaskHandle {
  const disconnectSub = natsAuth.subscribe("$SYS.ACCOUNT.*.DISCONNECT");
  let stopping = false;
  const task = (async () => {
    try {
      for await (const message of disconnectSub) {
        let data: { client?: { user_nkey?: string } };
        try {
          data = Value.Parse(NatsDisconnectEventSchema, JSON.parse(message.string())) as {
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

        const keys = (await connectionsKV.keys(`>.>.${userNkey}`)).take();
        if (isErr(keys)) continue;

        for await (const key of keys) {
          const parts = key.split(".");
          const sessionKey = parts[0];
          const trellisId = parts[1];
          if (!sessionKey || !trellisId) continue;

          const session = (await sessionKV.get(`${sessionKey}.${trellisId}`)).take();
          if (!isErr(session)) {
            const sessionValue = session.value as Session;
            if (sessionValue.type !== "workload") {
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

export function startAuthCallout(opts?: { contractStore?: ContractStore }): BackgroundTaskHandle {
  const xkp = fromSeed(new TextEncoder().encode(config.nats.authCallout.sxSeed));
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

      limiterRelease = await calloutLimiter.acquire({ ip: clientIp, server: serverName });
      if (!limiterRelease) {
        const response = await encodeAuthorizationResponse(
          userNkey,
          serverIdNkey,
          config.nats.authCallout.issuer.signing,
          { error: "rate_limited" },
          { aud: "trellis" },
        );
        message.respond(xkp.seal(new TextEncoder().encode(response), serverXkey));
        return;
      }

      const rawAuthToken = connectOpts.auth_token;
      if (!rawAuthToken) throw new Error("auth_token required");

      let authToken: ParsedNatsAuthToken;
      try {
        authToken = Value.Parse(NatsAuthTokenV1Schema, JSON.parse(rawAuthToken)) as ParsedNatsAuthToken;
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

      let workloadGrant: WorkloadRuntimeGrant | null = null;

      if (typeof authToken.bindingToken === "string" && authToken.bindingToken.length > 0) {
        const bindingToken = authToken.bindingToken;
        const bindingTokenHash = await hashKey(bindingToken);
        const mapped = (await bindingTokenKV.get(bindingTokenHash)).take();
        if (isErr(mapped)) throw new Error("invalid_binding_token");

        const record = mapped.value as { sessionKey?: unknown; expiresAt?: unknown };
        if (typeof record.sessionKey !== "string" || record.sessionKey !== sessionKey) {
          throw new Error("invalid_binding_token");
        }

        const expiresAt = record.expiresAt instanceof Date
          ? record.expiresAt
          : new Date(typeof record.expiresAt === "string" ? record.expiresAt : "");
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
          throw new Error("invalid_binding_token");
        }
        if (!(await verifyDomainSig(sessionKey, "nats-connect", bindingToken, sig))) {
          throw new Error("invalid_signature");
        }
      } else if (typeof authToken.iat === "number") {
        const iat = authToken.iat;
        const nowSec = Math.floor(now.getTime() / 1000);
        if (Math.abs(nowSec - iat) > 30) throw new Error("iat_out_of_range");
        if (!(await verifyDomainSig(sessionKey, "nats-connect", String(iat), sig))) {
          throw new Error("invalid_signature");
        }

        const svc = (await servicesKV.get(sessionKey)).take();
        if (!isErr(svc)) {
          const service = svc.value as ServiceRegistryEntry;
          if (!service.active) throw new Error("service_disabled");
        } else {
          workloadGrant = await resolveWorkloadRuntimeGrant(
            sessionKey,
            authToken.contractDigest,
            opts?.contractStore,
          );
        }
      } else {
        throw new Error("invalid_auth_token");
      }

      let sessionKeyId: string | undefined;
      const iter = (await sessionKV.keys(`${sessionKey}.>`)).take();
      if (!isErr(iter)) {
        const matches: string[] = [];
        for await (const key of iter) matches.push(key);

        if (matches.length > 1) {
          const connIter = (await connectionsKV.keys(`${sessionKey}.>.>`)).take();
          if (!isErr(connIter)) {
            for await (const key of connIter) {
              const entry = (await connectionsKV.get(key)).take();
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
        const svc = (await servicesKV.get(sessionKey)).take();
        let putResult;
        if (!isErr(svc)) {
          const service = svc.value as ServiceRegistryEntry;
          const trellisId = await trellisIdFromOriginId("service", sessionKey);
          const displayName = service.displayName;
          sessionKeyId = `${sessionKey}.${trellisId}`;
          putResult = (await sessionKV.put(sessionKeyId, {
            type: "service",
            trellisId,
            origin: "service",
            id: sessionKey,
            email: `${displayName || "service"}@trellis.internal`,
            name: displayName,
            createdAt: now,
            lastAuth: now,
          })).take();
        } else if (workloadGrant) {
          sessionKeyId = `${sessionKey}.${workloadGrant.activation.instanceId}`;
          // The first successful runtime auth marks when an approved device was
          // actually used, which is distinct from the earlier review timestamp.
          putResult = (await sessionKV.put(sessionKeyId, {
            type: "workload",
            instanceId: workloadGrant.activation.instanceId,
            publicIdentityKey: workloadGrant.activation.publicIdentityKey,
            profileId: workloadGrant.profile.profileId,
            contractId: workloadGrant.contractId,
            contractDigest: workloadGrant.contractDigest,
            delegatedCapabilities: workloadGrant.capabilities,
            delegatedPublishSubjects: workloadGrant.publishSubjects,
            delegatedSubscribeSubjects: workloadGrant.subscribeSubjects,
            createdAt: now,
            lastAuth: now,
            activatedAt: workloadGrant.activation.activatedAt ? new Date(workloadGrant.activation.activatedAt) : null,
            revokedAt: workloadGrant.activation.revokedAt ? new Date(workloadGrant.activation.revokedAt) : null,
          })).take();
        } else {
          throw new Error("session_not_found");
        }
        if (isErr(putResult)) {
          logger.error({ error: putResult.error, sessionKeyId }, "Failed to create service session");
          throw new Error("session_create_failed");
        }
      }

      const sessionEntry = (await sessionKV.get(sessionKeyId)).take();
      if (isErr(sessionEntry)) throw new Error("session_not_found");
      let session = sessionEntry.value as Session;

      if (session.type === "workload") {
        const currentGrant = workloadGrant ?? await resolveWorkloadRuntimeGrant(
          sessionKey,
          session.contractDigest,
          opts?.contractStore,
        );
        let activatedAt = currentGrant.activation.activatedAt ? new Date(currentGrant.activation.activatedAt) : null;
        if (activatedAt === null) {
          const activatedAtIso = now.toISOString();
          activatedAt = now;
          await workloadActivationsKV.put(currentGrant.activation.instanceId, {
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
          revokedAt: currentGrant.activation.revokedAt ? new Date(currentGrant.activation.revokedAt) : null,
        };
      }

      const inboxPrefix = `_INBOX.${sessionKey.slice(0, 16)}`;
      let resourcePermissions = { publish: [] as string[], subscribe: [] as string[] };
      const principal = await resolveSessionPrincipal(session, sessionKey, {
        servicesKV,
        usersKV,
        workloadActivationsKV,
        workloadProfilesKV,
      });
      if (!principal.ok) {
        throw new Error(principal.error.reason);
      }

      if (principal.value.serviceState) {
        resourcePermissions = getResourcePermissionGrants(
          principal.value.serviceState.resourceBindings,
        );
      }

      (await sessionKV.put(sessionKeyId, { ...session, lastAuth: now })).take();

      const serverId = natsReq.server_id?.id ?? serverName;
      const clientId = natsReq.client_info?.id;
      const sessionScope = session.type === "workload" ? session.instanceId : session.trellisId;
      if (serverId && typeof clientId === "number") {
        (
          await connectionsKV.put(`${sessionKey}.${sessionScope}.${userNkey}`, {
            serverId,
            clientId,
            connectedAt: now,
          })
        ).inspectErr((error) => logger.warn({ error }, "Failed to track connection"));
      }

      if (session.type !== "workload") {
        (
          await trellis.publish("Auth.Connect", {
            origin: session.origin,
            id: session.id,
            sessionKey,
            userNkey,
          })
        ).inspectErr((error) => logger.warn({ error }, "Failed to publish Auth.Connect"));
      }

      const isService = session.type === "service";
      const delegatedPublish = session.type === "service"
        ? []
        : session.delegatedPublishSubjects!
      ;
      const delegatedSubscribe = session.type === "service"
        ? []
        : session.delegatedSubscribeSubjects!
      ;
      const permissions: Partial<User> = {
        pub: {
          allow: [...new Set([
            ...(isService
              ? getServicePublishSubjects(principal.value.capabilities, {
                sessionKey,
                contractDigest: principal.value.serviceState?.contractDigest,
                displayName: principal.value.serviceState?.displayName,
                })
              : delegatedPublish),
            ...(session.type === "user" && delegatedPublish.length > 0 && AUTH_RENEW_SUBJECT ? [AUTH_RENEW_SUBJECT] : []),
            ...resourcePermissions.publish,
          ])],
        },
        resp: { max: 1 },
        sub: {
          allow: [...new Set(
            isService
              ? [
                ...getServiceSubscribeSubjects(principal.value.capabilities, {
                  sessionKey,
                  contractDigest: principal.value.serviceState?.contractDigest,
                  displayName: principal.value.serviceState?.displayName,
                 }),
                 ...resourcePermissions.subscribe,
                 `${inboxPrefix}.>`,
              ]
              : [...delegatedSubscribe, `${inboxPrefix}.>`],
          )],
        },
        locale: Intl.DateTimeFormat().resolvedOptions().timeZone,
        data: 100 * 1000000,
        subs: 1500,
        issuer_account: config.nats.authCallout.target.nkey,
      };
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
      const messageText = error instanceof Error ? error.message : "Unknown error";
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
          message.respond(xkp.seal(new TextEncoder().encode(response), serverXkey));
        } else {
          message.respond("");
        }
      });
      if (respondResult.isErr()) {
        logger.error({ error: respondResult.error }, "Failed to respond to auth callout error");
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
