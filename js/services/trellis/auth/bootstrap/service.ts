import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import type { NatsConnection } from "@nats-io/nats-core";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ContractsModule } from "../../catalog/runtime.ts";
import {
  type ContractResourceBindings,
  provisionContractResourceBindings,
  type ResourceProvisioningOptions,
} from "../../catalog/resources.ts";
import { resolveContractUsesFromEntries } from "../../catalog/uses.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import {
  computeEnvelopeDelta,
  evaluateEnvelopeFit,
} from "../envelope_decision.ts";
import { SessionKeySchema, SignatureSchema } from "../schemas.ts";
import type {
  DeploymentContractEvidence,
  DeploymentEnvelope,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
  SentinelCreds,
} from "../schemas.ts";

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

type ServiceBootstrapDeployment = {
  deploymentId: string;
  namespaces: string[];
  disabled: boolean;
};

type DeploymentEnvelopeStorage = {
  get(deploymentId: string): Promise<DeploymentEnvelope | undefined>;
  putExpansion?(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    contractEvidence: DeploymentContractEvidence;
  }): Promise<void>;
};

type DeploymentResourceBindingStorage = {
  get(
    deploymentId: string,
    kind: string,
    alias: string,
  ): Promise<DeploymentResourceBinding | undefined>;
  put(record: DeploymentResourceBinding): Promise<void>;
  listByDeployment(deploymentId: string): Promise<DeploymentResourceBinding[]>;
};

type DeploymentContractEvidenceStorage = {
  get(
    deploymentId: string,
    contractDigest: string,
  ): Promise<DeploymentContractEvidence | undefined>;
  put(record: DeploymentContractEvidence): Promise<void>;
};

type EnvelopeExpansionRequestStorage = {
  putPending(
    record: EnvelopeExpansionRequest,
  ): Promise<EnvelopeExpansionRequest>;
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
  contracts: Pick<
    ContractsModule,
    | "getActiveEntries"
    | "getContract"
    | "validateContract"
  >;
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
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
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
  nats?: NatsConnection;
  provisionResourceBindings?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
    options?: ResourceProvisioningOptions,
  ) => Promise<ContractResourceBindings>;
  resourceProvisioningOptions?: ResourceProvisioningOptions;
  nowSeconds?(): number;
  now?(): Date;
  createExpansionRequestId?(): string;
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

async function getRequiredServiceCapabilities(
  contracts: Pick<ContractsModule, "getActiveEntries">,
  contract: TrellisContractV1,
): Promise<string[]> {
  const capabilities = new Set<string>(["service"]);
  const uses = resolveContractUsesFromEntries(
    await contracts.getActiveEntries(),
    contract,
  );
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

function emptyBoundary(): EnvelopeBoundary {
  return { contracts: [], surfaces: [], capabilities: [], resources: [] };
}

function mergeBoundaries(...boundaries: EnvelopeBoundary[]): EnvelopeBoundary {
  return computeEnvelopeDelta(emptyBoundary(), {
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

function isEmptyBoundary(boundary: EnvelopeBoundary): boolean {
  return boundary.contracts.length === 0 && boundary.surfaces.length === 0 &&
    boundary.capabilities.length === 0 && boundary.resources.length === 0;
}

function resourceKey(kind: string, alias: string): string {
  return `${kind}\u001f${alias}`;
}

function resourceBindingsForResponse(
  records: DeploymentResourceBinding[],
): Record<string, Record<string, unknown>> {
  const resources: Record<string, Record<string, unknown>> = {};
  for (const record of records) {
    resources[record.kind] ??= {};
    resources[record.kind][record.alias] = record.binding;
  }
  return resources;
}

function missingResourceBindingKeys(
  requested: EnvelopeBoundary,
  bindings: DeploymentResourceBinding[],
): string[] {
  const produced = new Set(
    bindings.map((binding) => resourceKey(binding.kind, binding.alias)),
  );
  const missing: string[] = [];
  for (const resource of requested.resources) {
    if (resource.kind === "transfer") continue;
    const key = resourceKey(resource.kind, resource.alias);
    if (!produced.has(key)) missing.push(key);
  }
  return missing.sort((left, right) => left.localeCompare(right));
}

async function buildResourceBindingRecords(input: {
  deploymentId: string;
  bindings: ContractResourceBindings;
  requested: EnvelopeBoundary;
  existing: Map<string, DeploymentResourceBinding>;
  now: string;
}): Promise<DeploymentResourceBinding[]> {
  const requestedKeys = new Set(
    input.requested.resources
      .filter((resource) => resource.kind !== "transfer")
      .map((resource) => resourceKey(resource.kind, resource.alias)),
  );
  const records: DeploymentResourceBinding[] = [];

  for (const [alias, binding] of Object.entries(input.bindings.kv ?? {})) {
    if (!requestedKeys.has(resourceKey("kv", alias))) continue;
    const existing = input.existing.get(resourceKey("kv", alias));
    records.push({
      deploymentId: input.deploymentId,
      kind: "kv",
      alias,
      binding: {
        bucket: binding.bucket,
        history: binding.history,
        ttlMs: binding.ttlMs,
        ...(binding.maxValueBytes !== undefined
          ? { maxValueBytes: binding.maxValueBytes }
          : {}),
      },
      limits: null,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    });
  }

  for (const [alias, binding] of Object.entries(input.bindings.store ?? {})) {
    if (!requestedKeys.has(resourceKey("store", alias))) continue;
    const existing = input.existing.get(resourceKey("store", alias));
    records.push({
      deploymentId: input.deploymentId,
      kind: "store",
      alias,
      binding: {
        name: binding.name,
        ttlMs: binding.ttlMs,
        ...(binding.maxTotalBytes !== undefined
          ? { maxTotalBytes: binding.maxTotalBytes }
          : {}),
      },
      limits: null,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    });
  }

  if (input.bindings.jobs) {
    for (const [alias, queue] of Object.entries(input.bindings.jobs.queues)) {
      if (!requestedKeys.has(resourceKey("jobs", alias))) continue;
      const existing = input.existing.get(resourceKey("jobs", alias));
      records.push({
        deploymentId: input.deploymentId,
        kind: "jobs",
        alias,
        binding: {
          namespace: input.bindings.jobs.namespace,
          workStream: input.bindings.jobs.workStream,
          queueType: queue.queueType,
          publishPrefix: queue.publishPrefix,
          workSubject: queue.workSubject,
          consumerName: queue.consumerName,
          payload: queue.payload,
          ...(queue.result ? { result: queue.result } : {}),
          maxDeliver: queue.maxDeliver,
          backoffMs: queue.backoffMs,
          ackWaitMs: queue.ackWaitMs,
          ...(queue.defaultDeadlineMs
            ? { defaultDeadlineMs: queue.defaultDeadlineMs }
            : {}),
          progress: queue.progress,
          logs: queue.logs,
          dlq: queue.dlq,
          concurrency: queue.concurrency,
        },
        limits: null,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now,
      });
    }
  }

  return records.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.alias.localeCompare(right.alias)
  );
}

function contractEvidenceRecord(input: {
  deploymentId: string;
  contract: TrellisContractV1;
  digest: string;
  now: string;
  existing?: DeploymentContractEvidence;
}): DeploymentContractEvidence {
  return {
    deploymentId: input.deploymentId,
    contractId: input.contract.id,
    contractDigest: input.digest,
    contract: { ...input.contract },
    firstSeenAt: input.existing?.firstSeenAt ?? input.now,
    lastSeenAt: input.now,
  };
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

    const deploymentEnvelope = await deps.deploymentEnvelopeStorage.get(
      service.deploymentId,
    );
    if (!deploymentEnvelope || deploymentEnvelope.disabled) {
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

    const existingEvidence = await deps.deploymentContractEvidenceStorage.get(
      service.deploymentId,
      request.contractDigest,
    );
    let rawContract: unknown = request.contract ?? existingEvidence?.contract ??
      await deps.contracts.getContract(request.contractDigest, {
        includeInactive: true,
      });
    if (rawContract === undefined) {
      return c.json(
        bootstrapFailure(
          "manifest_required",
          `Service deployment '${deployment.deploymentId}' needs the full manifest for contract '${request.contractId}' digest '${request.contractDigest}' to evaluate the deployment envelope.`,
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

    let analysis;
    let validated;
    try {
      analysis = await analyzeContractEnvelopeBoundary(
        deps.contracts,
        rawContract,
      );
      validated = await deps.contracts.validateContract(rawContract);
    } catch {
      return c.json(
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
      );
    }

    const contract = validated.contract;
    if (analysis.contract.digest !== request.contractDigest) {
      return c.json(
        bootstrapFailure(
          "presented_contract_digest_mismatch",
          `Presented contract digest '${analysis.contract.digest}' does not match requested digest '${request.contractDigest}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            expectedContractDigest: request.contractDigest,
            presentedContractDigest: analysis.contract.digest,
          },
        ),
        409,
      );
    }
    if (contract.id !== request.contractId) {
      return c.json(
        bootstrapFailure(
          "presented_contract_id_mismatch",
          `Presented contract id '${contract.id}' does not match requested contract '${request.contractId}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            expectedContractId: request.contractId,
            presentedContractId: contract.id,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      );
    }

    if (request.contract !== undefined && deps.storePresentedContract) {
      await deps.storePresentedContract({
        contract,
        digest: request.contractDigest,
        canonical: validated.canonical,
      });
    }

    const requestedBoundary = mergeBoundaries(
      analysis.required,
      analysis.contributedAvailability,
    );
    const fit = evaluateEnvelopeFit(
      deploymentEnvelope.boundary,
      requestedBoundary,
    );
    const now = (deps.now?.() ?? new Date()).toISOString();
    const contractEvidence = contractEvidenceRecord({
      deploymentId: service.deploymentId,
      contract,
      digest: request.contractDigest,
      now,
      existing: existingEvidence,
    });

    if (!fit.fits) {
      const delta = computeEnvelopeDelta(
        deploymentEnvelope.boundary,
        requestedBoundary,
      );
      const requestId = deps.createExpansionRequestId?.() ??
        crypto.randomUUID();
      await deps.deploymentContractEvidenceStorage.put(contractEvidence);
      const expansionRequest = await deps.envelopeExpansionRequestStorage
        .putPending({
          requestId,
          deploymentId: service.deploymentId,
          requestedByKind: "service",
          requestedBy: { instanceId: service.instanceId },
          contractId: request.contractId,
          contractDigest: request.contractDigest,
          contract: { ...contract },
          state: "pending",
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
          decisionReason: null,
          delta,
        });
      return c.json(
        bootstrapFailure(
          "envelope_expansion_required",
          `Service deployment '${service.deploymentId}' envelope does not cover contract '${request.contractId}' digest '${request.contractDigest}'. An expansion request was created.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            requestId: expansionRequest.requestId,
            delta,
            missingAvailability: fit.missingAvailability,
            missingCapabilities: fit.missingCapabilities,
          },
        ),
        202,
      );
    }

    const existingBindings = await deps.deploymentResourceBindingStorage
      .listByDeployment(service.deploymentId);
    const existingBindingByKey = new Map(
      existingBindings.map((binding) => [
        resourceKey(binding.kind, binding.alias),
        binding,
      ]),
    );
    const requiredResourceKeys = new Set(
      requestedBoundary.resources
        .filter((resource) => resource.kind !== "transfer")
        .map((resource) => resourceKey(resource.kind, resource.alias)),
    );
    let resourceBindingRecords = existingBindings.filter((binding) =>
      requiredResourceKeys.has(resourceKey(binding.kind, binding.alias))
    );
    if (resourceBindingRecords.length < requiredResourceKeys.size) {
      const provisioned = await (deps.provisionResourceBindings ??
        provisionContractResourceBindings)(
          deps.nats,
          contract,
          service.deploymentId,
          deps.resourceProvisioningOptions,
        );
      resourceBindingRecords = await buildResourceBindingRecords({
        deploymentId: service.deploymentId,
        bindings: provisioned,
        requested: requestedBoundary,
        existing: existingBindingByKey,
        now,
      });
      const recordByKey = new Map(
        existingBindings
          .filter((binding) =>
            requiredResourceKeys.has(resourceKey(binding.kind, binding.alias))
          )
          .map((
            binding,
          ) => [resourceKey(binding.kind, binding.alias), binding]),
      );
      for (const record of resourceBindingRecords) {
        recordByKey.set(resourceKey(record.kind, record.alias), record);
      }
      resourceBindingRecords = [...recordByKey.values()].sort((left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.alias.localeCompare(right.alias)
      );
    }

    const missingResourceBindings = missingResourceBindingKeys(
      requestedBoundary,
      resourceBindingRecords,
    );
    if (missingResourceBindings.length > 0) {
      return c.json(
        bootstrapFailure(
          "resource_binding_missing",
          "Resource provisioning did not produce all requested resource bindings.",
          { missingResourceBindings },
        ),
        409,
      );
    }

    if (deps.deploymentEnvelopeStorage.putExpansion) {
      await deps.deploymentEnvelopeStorage.putExpansion({
        envelope: deploymentEnvelope,
        delta: emptyBoundary(),
        resourceBindings: resourceBindingRecords,
        contractEvidence,
      });
    } else {
      for (const binding of resourceBindingRecords) {
        await deps.deploymentResourceBindingStorage.put(binding);
      }
      await deps.deploymentContractEvidenceStorage.put(contractEvidence);
    }

    const resourceBindings = resourceBindingsForResponse(
      resourceBindingRecords,
    );
    const capabilities = await getRequiredServiceCapabilities(
      deps.contracts,
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
