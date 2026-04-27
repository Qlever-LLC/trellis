import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ContractStore } from "../../catalog/store.ts";
import { provisionContractResourceBindings } from "../../catalog/resources.ts";
import { resolveContractUsesFromStore } from "../../catalog/uses.ts";
import { SessionKeySchema, SignatureSchema } from "../schemas.ts";
import type { SentinelCreds } from "../schemas.ts";

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
});

export type ServiceBootstrapDeps = {
  contractStore: ContractStore;
  nats?: Parameters<typeof provisionContractResourceBindings>[0];
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  sentinel: SentinelCreds;
  loadServiceInstance(instanceKey: string): Promise<
    {
      instanceId: string;
      deploymentId: string;
      instanceKey: string;
      disabled: boolean;
      currentContractId?: string;
      currentContractDigest?: string;
      capabilities: string[];
      resourceBindings?: Record<string, unknown>;
      createdAt: string | Date;
    } | null
  >;
  saveServiceInstance(instance: {
    instanceId: string;
    deploymentId: string;
    instanceKey: string;
    disabled: boolean;
    currentContractId?: string;
    currentContractDigest?: string;
    capabilities: string[];
    resourceBindings?: Record<string, unknown>;
    createdAt: string | Date;
  }): Promise<void>;
  loadServiceDeployment(deploymentId: string): Promise<
    {
      deploymentId: string;
      disabled: boolean;
      appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
    } | null
  >;
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
    ...(contract.jobs ? { jobs: contract.jobs } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

function bootstrapFailure(
  reason: string,
  message?: string,
  extra?: Record<string, unknown>,
) {
  return {
    reason,
    ...(message ? { message } : {}),
    ...(extra ?? {}),
  };
}

function getRequiredServiceCapabilities(
  contractStore: ContractStore,
  contract: TrellisContractV1,
): string[] {
  const capabilities = new Set<string>(["service"]);
  const uses = resolveContractUsesFromStore(contractStore, contract);
  const events = contract.events as
    | Record<string, {
      capabilities?: { publish?: string[] };
    }>
    | undefined;
  const subjects = contract.subjects as
    | Record<string, {
      capabilities?: { publish?: string[]; subscribe?: string[] };
    }>
    | undefined;

  for (const event of Object.values(events ?? {})) {
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const subject of Object.values(subjects ?? {})) {
    for (const capability of subject.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
    for (const capability of subject.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  for (const method of uses.rpcCalls) {
    for (const capability of method.method.capabilities?.call ?? []) {
      capabilities.add(capability);
    }
  }
  for (const operation of uses.operationCalls) {
    for (const capability of operation.operation.capabilities?.call ?? []) {
      capabilities.add(capability);
    }
  }
  for (const event of uses.eventPublishes) {
    for (const capability of event.event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }
  for (const event of uses.eventSubscribes) {
    for (const capability of event.event.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }
  for (const subject of uses.subjectPublishes) {
    for (const capability of subject.subject.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }
  for (const subject of uses.subjectSubscribes) {
    for (const capability of subject.subject.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

function sameJsonRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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
      return c.json({ reason: "iat_out_of_range", serverNow: nowSeconds }, 400);
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
      return c.json(
        bootstrapFailure(
          "unknown_service",
          `Service instance for session key '${request.sessionKey}' is not provisioned in Trellis. Provision the instance before starting the service.`,
        ),
        404,
      );
    }
    if (service.disabled) {
      return c.json(
        bootstrapFailure(
          "service_disabled",
          `Service instance '${service.instanceId}' is disabled in Trellis. Enable the instance or provision a new one before reconnecting.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
          },
        ),
        403,
      );
    }

    const deployment = await deps.loadServiceDeployment(service.deploymentId);
    if (!deployment || deployment.disabled) {
      return c.json(
        bootstrapFailure(
          "service_deployment_disabled",
          `Service deployment '${service.deploymentId}' is disabled or missing in Trellis. Enable the deployment before reconnecting this instance.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
          },
        ),
        403,
      );
    }

    const applied = deployment.appliedContracts.find((entry) =>
      entry.allowedDigests.includes(request.contractDigest)
    );
    if (!applied || applied.contractId !== request.contractId) {
      const matchingLineage = deployment.appliedContracts.find((entry) =>
        entry.contractId === request.contractId
      );
      const allowedDigests = matchingLineage?.allowedDigests ?? [];
      const message = allowedDigests.length > 0
        ? `Service instance '${service.instanceId}' under deployment '${deployment.deploymentId}' is not allowed to run digest '${request.contractDigest}' for contract '${request.contractId}'. Allowed digests: ${
          allowedDigests.join(", ")
        }. Re-apply the current contract to the deployment or restart the matching service revision.`
        : `Service instance '${service.instanceId}' under deployment '${deployment.deploymentId}' is not allowed to run contract '${request.contractId}' digest '${request.contractDigest}'. Apply that contract to the deployment before starting the service.`;
      return c.json(
        bootstrapFailure(
          "service_contract_mismatch",
          message,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            expectedContractId: request.contractId,
            expectedContractDigest: request.contractDigest,
            allowedDigests,
            currentContractId: service.currentContractId ?? null,
            currentContractDigest: service.currentContractDigest ?? null,
          },
        ),
        409,
      );
    }

    const contract = deps.contractStore.getContract(request.contractDigest, {
      includeInactive: true,
    });
    if (!contract || contract.id !== request.contractId) {
      return c.json(
        bootstrapFailure(
          "contract_not_installed",
          `Contract '${request.contractId}' digest '${request.contractDigest}' is allowed for deployment '${deployment.deploymentId}' but is not installed in Trellis. Install the contract before starting the service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      );
    }

    const resourceBindings = deps.nats
      ? await provisionContractResourceBindings(
        deps.nats,
        contract,
        service.deploymentId,
      )
      : service.resourceBindings;
    const capabilities = getRequiredServiceCapabilities(
      deps.contractStore,
      contract,
    );

    let nextService = service;
    if (
      service.currentContractDigest !== request.contractDigest ||
      service.currentContractId !== request.contractId ||
      !service.resourceBindings ||
      !sameJsonRecord(service.resourceBindings, resourceBindings) ||
      !sameJsonRecord(service.capabilities, capabilities)
    ) {
      nextService = {
        ...service,
        currentContractId: request.contractId,
        currentContractDigest: request.contractDigest,
        capabilities,
        resourceBindings,
      };
      await deps.saveServiceInstance(nextService);
      await deps.refreshActiveContracts();
    }

    return c.json({
      status: "ready",
      serverNow: nowSeconds,
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
