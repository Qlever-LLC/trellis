import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ContractStore } from "../../catalog/store.ts";
import { provisionContractResourceBindings } from "../../catalog/resources.ts";
import { resolveContractUsesFromStore } from "../../catalog/uses.ts";
import {
  SessionKeySchema,
  SignatureSchema,
} from "../../state/schemas/auth_state.ts";
import type { SentinelCreds } from "../../state/schemas.ts";

export const DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS = 30;

export function isServiceBootstrapProofIatFresh(
  iat: number,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  skewSeconds: number = DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS,
): boolean {
  return Math.abs(nowSeconds - iat) <= skewSeconds;
}

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const ServiceBootstrapRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: SignatureSchema,
}, { additionalProperties: false });

export type ServiceBootstrapDeps = {
  contractStore: ContractStore;
  nats?: Parameters<typeof provisionContractResourceBindings>[0];
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  sentinel: SentinelCreds;
  loadServiceInstance(instanceKey: string): Promise<{
    instanceId: string;
    profileId: string;
    instanceKey: string;
    disabled: boolean;
    currentContractId?: string;
    currentContractDigest?: string;
    capabilities: string[];
    resourceBindings?: Record<string, unknown>;
    createdAt: string | Date;
  } | null>;
  saveServiceInstance(instance: {
    instanceId: string;
    profileId: string;
    instanceKey: string;
    disabled: boolean;
    currentContractId?: string;
    currentContractDigest?: string;
    capabilities: string[];
    resourceBindings?: Record<string, unknown>;
    createdAt: string | Date;
  }): Promise<void>;
  loadServiceProfile(profileId: string): Promise<{
    profileId: string;
    disabled: boolean;
    appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
  } | null>;
  refreshActiveContracts(): Promise<void>;
  verifyIdentityProof(input: {
    sessionKey: string;
    iat: number;
    sig: string;
  }): Promise<boolean>;
  nowSeconds?(): number;
};

function buildContractView(contract: TrellisContractV1, digest: string) {
  return {
    id: contract.id,
    digest,
    displayName: contract.displayName,
    description: contract.description,
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

function getRequiredServiceCapabilities(
  contractStore: ContractStore,
  contract: TrellisContractV1,
): string[] {
  const capabilities = new Set<string>(["service"]);
  const uses = resolveContractUsesFromStore(contractStore, contract);

  for (const event of Object.values(contract.events ?? {})) {
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const subject of Object.values(contract.subjects ?? {})) {
    for (const capability of subject.capabilities?.publish ?? []) capabilities.add(capability);
    for (const capability of subject.capabilities?.subscribe ?? []) capabilities.add(capability);
  }

  for (const method of uses.rpcCalls) {
    for (const capability of method.method.capabilities?.call ?? []) capabilities.add(capability);
  }
  for (const event of uses.eventPublishes) {
    for (const capability of event.event.capabilities?.publish ?? []) capabilities.add(capability);
  }
  for (const event of uses.eventSubscribes) {
    for (const capability of event.event.capabilities?.subscribe ?? []) capabilities.add(capability);
  }
  for (const subject of uses.subjectPublishes) {
    for (const capability of subject.subject.capabilities?.publish ?? []) capabilities.add(capability);
  }
  for (const subject of uses.subjectSubscribes) {
    for (const capability of subject.subject.capabilities?.subscribe ?? []) capabilities.add(capability);
  }

  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

export function createServiceBootstrapHandler(deps: ServiceBootstrapDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(ServiceBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = body;
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isServiceBootstrapProofIatFresh(request.iat, nowSeconds)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }

    const proofOk = await deps.verifyIdentityProof({
      sessionKey: request.sessionKey,
      iat: request.iat,
      sig: request.sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    const service = await deps.loadServiceInstance(request.sessionKey);
    if (!service) {
      return c.json({ reason: "unknown_service" }, 404);
    }
    if (service.disabled) {
      return c.json({ reason: "service_disabled" }, 403);
    }

    const profile = await deps.loadServiceProfile(service.profileId);
    if (!profile || profile.disabled) {
      return c.json({ reason: "service_profile_disabled" }, 403);
    }

    const applied = profile.appliedContracts.find((entry) =>
      entry.allowedDigests.includes(request.contractDigest)
    );
    if (!applied || applied.contractId !== request.contractId) {
      return c.json({ reason: "service_contract_mismatch" }, 409);
    }

    const contract = deps.contractStore.getContract(request.contractDigest, { includeInactive: true });
    if (!contract || contract.id !== request.contractId) {
      return c.json({ reason: "contract_not_active" }, 409);
    }

    let nextService = service;
    if (
      service.currentContractDigest !== request.contractDigest ||
      service.currentContractId !== request.contractId ||
      !service.resourceBindings
    ) {
      const resourceBindings = await provisionContractResourceBindings(
        deps.nats,
        contract,
        service.instanceKey,
      );
      nextService = {
        ...service,
        currentContractId: request.contractId,
        currentContractDigest: request.contractDigest,
        capabilities: getRequiredServiceCapabilities(deps.contractStore, contract),
        resourceBindings,
      };
      await deps.saveServiceInstance(nextService);
      await deps.refreshActiveContracts();
    }

    return c.json({
      status: "ready",
      connectInfo: {
        sessionKey: request.sessionKey,
        contractId: request.contractId,
        contractDigest: request.contractDigest,
        transports: deps.transports,
        transport: {
          sentinel: deps.sentinel,
        },
        auth: {
          mode: "service_identity" as const,
          iatSkewSeconds: DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS,
        },
      },
      contract: buildContractView(contract, request.contractDigest),
      binding: {
        contractId: request.contractId,
        digest: request.contractDigest,
        resources: nextService.resourceBindings,
      },
    });
  };
}
