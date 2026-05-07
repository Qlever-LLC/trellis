import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ContractStore } from "../../catalog/store.ts";
import { getContractResourceAnalysis } from "../../catalog/resources.ts";
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

type ServiceBootstrapInstance = {
  instanceId: string;
  deploymentId: string;
  instanceKey: string;
  disabled: boolean;
  currentContractId?: string;
  currentContractDigest?: string;
  capabilities: string[];
  resourceBindings?: Record<string, unknown>;
  createdAt: string | Date;
};

type ServiceBootstrapAppliedContract = {
  contractId: string;
  compatibilityPolicy: "exact" | "compatible-additive" | "manual";
  allowedDigests: string[];
  resourceBindingsByDigest?: Record<string, Record<string, unknown>>;
};

type ServiceBootstrapDeployment = {
  deploymentId: string;
  namespaces: string[];
  firstConnectPolicy: "reject" | "quarantine" | "auto-accept-compatible";
  disabled: boolean;
  appliedContracts: ServiceBootstrapAppliedContract[];
};

export const ServiceBootstrapRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  contract: Type.Optional(Type.Unknown()),
  iat: Type.Number(),
  sig: SignatureSchema,
});

export type ServiceBootstrapDeps = {
  contractStore: ContractStore;
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  sentinel: SentinelCreds;
  loadServiceInstance(
    instanceKey: string,
  ): Promise<ServiceBootstrapInstance | null>;
  saveServiceInstance(instance: ServiceBootstrapInstance): Promise<void>;
  loadServiceDeployment(deploymentId: string): Promise<
    ServiceBootstrapDeployment | null
  >;
  saveServiceDeployment?(deployment: ServiceBootstrapDeployment): Promise<void>;
  storePresentedContract?(input: {
    contract: TrellisContractV1;
    digest: string;
    canonical: string;
  }): Promise<void>;
  verifyIdentityProof(input: {
    sessionKey: string;
    iat: number;
    contractDigest: string;
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
  for (const event of Object.values(events ?? {})) {
    for (const capability of event.capabilities?.publish ?? []) {
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
  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

function sameJsonRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function hasDeclaredResourcesOrJobs(contract: TrellisContractV1): boolean {
  const analysis = getContractResourceAnalysis(contract);
  return analysis.kv.length > 0 || analysis.store.length > 0 ||
    analysis.jobs.length > 0;
}

async function autoAcceptPresentedServiceContract(args: {
  deps: ServiceBootstrapDeps;
  deployment: ServiceBootstrapDeployment;
  applied: ServiceBootstrapAppliedContract;
  service: ServiceBootstrapInstance;
  request: {
    contractId: string;
    contractDigest: string;
    contract?: unknown;
  };
  c: Context;
}): Promise<
  | {
    accepted: true;
    contract: TrellisContractV1;
    deployment: ServiceBootstrapDeployment;
  }
  | { accepted: false; response: Response }
> {
  const { deps, deployment, applied, service, request, c } = args;
  if (
    deployment.firstConnectPolicy !== "auto-accept-compatible" ||
    applied.compatibilityPolicy !== "compatible-additive"
  ) {
    return {
      accepted: false,
      response: serviceContractMismatch(c, service, deployment, request),
    };
  }

  if (request.contract === undefined) {
    return {
      accepted: false,
      response: c.json(
        bootstrapFailure(
          "manifest_required",
          `Service deployment '${deployment.deploymentId}' may accept contract '${request.contractId}' digest '${request.contractDigest}', but Trellis needs the full manifest to evaluate the deployment envelope.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      ),
    };
  }

  if (!deps.storePresentedContract || !deps.saveServiceDeployment) {
    return {
      accepted: false,
      response: c.json(
        bootstrapFailure(
          "presented_contract_auto_accept_unavailable",
          "Service contract auto-accept is not configured for this bootstrap endpoint. Apply and review the contract manually before starting this service.",
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      ),
    };
  }

  let presented;
  try {
    presented = await deps.contractStore.validate(request.contract);
  } catch {
    return {
      accepted: false,
      response: c.json(
        bootstrapFailure(
          "presented_contract_invalid",
          "Presented contract manifest is invalid. Review and apply a valid contract before starting this service.",
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      ),
    };
  }
  if (presented.digest !== request.contractDigest) {
    return {
      accepted: false,
      response: c.json(
        bootstrapFailure(
          "presented_contract_digest_mismatch",
          `Presented contract digest '${presented.digest}' does not match requested digest '${request.contractDigest}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            expectedContractDigest: request.contractDigest,
            presentedContractDigest: presented.digest,
          },
        ),
        409,
      ),
    };
  }

  if (
    presented.contract.id !== request.contractId ||
    presented.contract.id !== applied.contractId
  ) {
    return {
      accepted: false,
      response: c.json(
        bootstrapFailure(
          "presented_contract_id_mismatch",
          `Presented contract id '${presented.contract.id}' does not match requested contract '${request.contractId}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            expectedContractId: request.contractId,
            presentedContractId: presented.contract.id,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      ),
    };
  }

  if (hasDeclaredResourcesOrJobs(presented.contract)) {
    return {
      accepted: false,
      response: c.json(
        bootstrapFailure(
          "presented_contract_requires_manual_review",
          `Presented contract '${request.contractId}' digest '${request.contractDigest}' declares resources or jobs. Apply and review the contract manually before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      ),
    };
  }

  await deps.storePresentedContract({
    contract: presented.contract,
    digest: presented.digest,
    canonical: presented.canonical,
  });
  deps.contractStore.add(presented.digest, presented.contract);
  const nextDeployment: ServiceBootstrapDeployment = {
    ...deployment,
    appliedContracts: deployment.appliedContracts.map((entry) => {
      if (entry !== applied) return entry;
      return {
        ...entry,
        allowedDigests: [...entry.allowedDigests, presented.digest],
      };
    }),
  };
  await deps.saveServiceDeployment(nextDeployment);
  return {
    accepted: true,
    contract: presented.contract,
    deployment: nextDeployment,
  };
}

function serviceContractMismatch(
  c: Context,
  service: ServiceBootstrapInstance,
  deployment: ServiceBootstrapDeployment,
  request: { contractId: string; contractDigest: string },
): Response {
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
      contractDigest: request.contractDigest,
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

    let contract = deps.contractStore.getContract(request.contractDigest, {
      includeInactive: true,
    });
    const exactApplied = deployment.appliedContracts.find((entry) =>
      entry.contractId === request.contractId &&
      entry.allowedDigests.includes(request.contractDigest)
    );
    const matchingLineage = deployment.appliedContracts.find((entry) =>
      entry.contractId === request.contractId
    );
    let effectiveDeployment = deployment;
    let applied = exactApplied;
    if (!applied) {
      if (!matchingLineage) {
        return serviceContractMismatch(c, service, deployment, request);
      }
      const accepted = await autoAcceptPresentedServiceContract({
        deps,
        deployment,
        applied: matchingLineage,
        service,
        request,
        c,
      });
      if (!accepted.accepted) return accepted.response;
      contract = accepted.contract;
      effectiveDeployment = accepted.deployment;
      applied = effectiveDeployment.appliedContracts.find((entry) =>
        entry.contractId === request.contractId &&
        entry.allowedDigests.includes(request.contractDigest)
      );
      if (!applied) {
        return serviceContractMismatch(
          c,
          service,
          effectiveDeployment,
          request,
        );
      }
    }

    if (!contract || contract.id !== request.contractId) {
      return c.json(
        bootstrapFailure(
          "contract_not_installed",
          `Contract '${request.contractId}' digest '${request.contractDigest}' is allowed for deployment '${deployment.deploymentId}' but is not installed in Trellis. Install the contract before starting the service.`,
          {
            instanceId: service.instanceId,
            deploymentId: effectiveDeployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      );
    }

    const resourceBindings = applied.resourceBindingsByDigest?.[
      request.contractDigest
    ];
    if (
      resourceBindings === undefined && hasDeclaredResourcesOrJobs(contract)
    ) {
      return c.json(
        bootstrapFailure(
          "service_resource_bindings_missing",
          `Service deployment '${effectiveDeployment.deploymentId}' has applied contract '${request.contractId}' digest '${request.contractDigest}' with declared resources or jobs, but no stored resource bindings. Re-apply the contract to the deployment before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: effectiveDeployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      );
    }
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
        resourceBindings: resourceBindings ?? {},
      };
      await deps.saveServiceInstance(nextService);
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
