import type {
  AuthGetInstalledContractOutput,
  AuthListServiceDeploymentsOutput,
  AuthListServiceInstancesOutput,
} from "@qlever-llc/trellis/sdk/auth";
import { isJsonValue, type JsonValue } from "@qlever-llc/trellis/contracts";

type ContractDetail = AuthGetInstalledContractOutput["contract"];
type ServiceDeployment =
  AuthListServiceDeploymentsOutput["deployments"][number];
type AppliedContract = ServiceDeployment["appliedContracts"][number];
type JsonObject = { [key: string]: JsonValue };

export type AppliedApiSchemaRow = {
  name: string;
  exported: boolean;
  title?: string;
  description?: string;
  type: string;
  schema: JsonValue;
};

export type AppliedApiUseRow = {
  alias: string;
  contractId: string;
  rpcCalls: string[];
  operationCalls: string[];
  eventPublishes: string[];
  eventSubscribes: string[];
};

export type AppliedContractApiSummary = {
  id: string;
  deploymentId: string;
  contractId: string;
  digest: string;
  displayName?: string;
  description?: string;
  disabled: boolean;
  activeInstances: number;
  namespaces: string[];
  rpcMethods: number;
  operations: number;
  events: number;
  kvResources: number;
  storeResources: number;
  jobsQueues: number;
  boundKvResources: number;
  boundStoreResources: number;
  boundJobQueues: number;
};

export type AppliedApiGraphNode = {
  id: string;
  kind: "deployment" | "contract" | "external-contract";
  label: string;
  deploymentId?: string;
  contractId?: string;
  digest?: string;
  disabled?: boolean;
  activeInstances?: number;
};

export type AppliedApiGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "applies" | "uses";
  label?: string;
};

export type AppliedApiDependencyRow = {
  id: string;
  sourceDeploymentId: string;
  sourceContractId: string;
  sourceDigest: string;
  alias: string;
  targetContractId: string;
  targetDeploymentIds: string[];
  status: "resolved" | "ambiguous" | "unresolved";
  rpcCalls: string[];
  operationCalls: string[];
  eventPublishes: string[];
  eventSubscribes: string[];
};

export type AppliedApiDependencyGraph = {
  nodes: AppliedApiGraphNode[];
  edges: AppliedApiGraphEdge[];
};

function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && typeof value === "object" && value !== null &&
    !Array.isArray(value);
}

function getObjectProperty(
  source: JsonObject,
  key: string,
): JsonObject | undefined {
  const value = source[key];
  return isJsonObject(value) ? value : undefined;
}

function getStringProperty(
  source: JsonObject,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function getStringArrayProperty(source: JsonObject, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function manifestObject(detail: ContractDetail): JsonObject | undefined {
  return isJsonObject(detail.contract) ? detail.contract : undefined;
}

function schemaType(schema: JsonValue): string {
  if (typeof schema === "boolean") return schema ? "true" : "false";
  if (!isJsonObject(schema)) return "schema";

  const type = schema.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const types = type.filter((entry): entry is string =>
      typeof entry === "string"
    );
    if (types.length > 0) return types.join(" | ");
  }
  return "object";
}

function resourceBindingCounts(
  applied: AppliedContract,
  digest: string,
): Pick<
  AppliedContractApiSummary,
  "boundKvResources" | "boundStoreResources" | "boundJobQueues"
> {
  const bindings = applied.resourceBindingsByDigest?.[digest];
  const jobQueues = bindings?.jobs?.queues
    ? Object.keys(bindings.jobs.queues).length
    : 0;
  return {
    boundKvResources: bindings?.kv ? Object.keys(bindings.kv).length : 0,
    boundStoreResources: bindings?.store
      ? Object.keys(bindings.store).length
      : 0,
    boundJobQueues: jobQueues,
  };
}

function contractNodeId(contractId: string, digest?: string): string {
  return digest ? `contract:${contractId}:${digest}` : `contract:${contractId}`;
}

function graphEdgeId(
  kind: AppliedApiGraphEdge["kind"],
  source: string,
  target: string,
  label?: string,
): string {
  return label
    ? `${kind}:${source}->${target}:${label}`
    : `${kind}:${source}->${target}`;
}

function providerDeploymentIdsByContract(
  deployments: readonly ServiceDeployment[],
): Map<string, string[]> {
  const providers = new Map<string, Set<string>>();
  for (const deployment of deployments) {
    if (deployment.disabled) continue;
    for (const applied of deployment.appliedContracts) {
      const current = providers.get(applied.contractId) ?? new Set<string>();
      current.add(deployment.deploymentId);
      providers.set(applied.contractId, current);
    }
  }

  return new Map(
    [...providers.entries()].map(([contractId, deploymentIds]) => [
      contractId,
      [...deploymentIds].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function useEdgeLabel(use: AppliedApiUseRow): string {
  const parts = [
    use.rpcCalls.length ? `${use.rpcCalls.length} RPC` : "",
    use.operationCalls.length ? `${use.operationCalls.length} Op` : "",
    use.eventPublishes.length ? `${use.eventPublishes.length} Pub` : "",
    use.eventSubscribes.length ? `${use.eventSubscribes.length} Sub` : "",
  ].filter(Boolean);
  return parts.length ? `${use.alias}: ${parts.join(" / ")}` : use.alias;
}

/**
 * Builds table rows for the schemas embedded in an installed contract detail.
 */
export function getAppliedApiSchemaRows(
  detail: ContractDetail,
): AppliedApiSchemaRow[] {
  const manifest = manifestObject(detail);
  const schemas = manifest ? getObjectProperty(manifest, "schemas") : undefined;
  if (!schemas) return [];

  const exportsObject = manifest
    ? getObjectProperty(manifest, "exports")
    : undefined;
  const exportedSchemas = new Set(
    exportsObject ? getStringArrayProperty(exportsObject, "schemas") : [],
  );

  return Object.entries(schemas)
    .map(([name, schema]) => ({
      name,
      exported: exportedSchemas.has(name),
      title: isJsonObject(schema)
        ? getStringProperty(schema, "title")
        : undefined,
      description: isJsonObject(schema)
        ? getStringProperty(schema, "description")
        : undefined,
      type: schemaType(schema),
      schema,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Builds dependency table rows by resolving each declared use to provider deployments.
 */
export function getAppliedApiDependencyRows(
  deploymentsOutput: AuthListServiceDeploymentsOutput,
  contractDetails: readonly ContractDetail[] = [],
): AppliedApiDependencyRow[] {
  const detailsByDigest = new Map(
    contractDetails.map((detail) => [detail.digest, detail]),
  );
  const providersByContract = providerDeploymentIdsByContract(
    deploymentsOutput.deployments,
  );

  return deploymentsOutput.deployments.flatMap((deployment) =>
    deployment.appliedContracts.flatMap((applied) =>
      applied.allowedDigests.flatMap((digest) => {
        const detail = detailsByDigest.get(digest);
        if (!detail) return [];
        return getAppliedApiUseRows(detail).map((use) => {
          const targetDeploymentIds = providersByContract.get(use.contractId) ??
            [];
          const status: AppliedApiDependencyRow["status"] =
            targetDeploymentIds.length === 0
              ? "unresolved"
              : targetDeploymentIds.length === 1
              ? "resolved"
              : "ambiguous";
          return {
            id:
              `${deployment.deploymentId}:${applied.contractId}:${digest}:${use.alias}`,
            sourceDeploymentId: deployment.deploymentId,
            sourceContractId: applied.contractId,
            sourceDigest: digest,
            alias: use.alias,
            targetContractId: use.contractId,
            targetDeploymentIds,
            status,
            rpcCalls: use.rpcCalls,
            operationCalls: use.operationCalls,
            eventPublishes: use.eventPublishes,
            eventSubscribes: use.eventSubscribes,
          };
        });
      })
    )
  ).sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Builds table rows for cross-contract API dependencies declared by a contract.
 */
export function getAppliedApiUseRows(
  detail: ContractDetail,
): AppliedApiUseRow[] {
  const manifest = manifestObject(detail);
  const uses = manifest ? getObjectProperty(manifest, "uses") : undefined;
  if (!uses) return [];

  return Object.entries(uses)
    .flatMap(([alias, value]) => {
      if (!isJsonObject(value)) return [];
      const contractId = getStringProperty(value, "contract");
      if (!contractId) return [];

      const rpc = getObjectProperty(value, "rpc");
      const operations = getObjectProperty(value, "operations");
      const events = getObjectProperty(value, "events");
      return [{
        alias,
        contractId,
        rpcCalls: rpc ? getStringArrayProperty(rpc, "call") : [],
        operationCalls: operations
          ? getStringArrayProperty(operations, "call")
          : [],
        eventPublishes: events ? getStringArrayProperty(events, "publish") : [],
        eventSubscribes: events
          ? getStringArrayProperty(events, "subscribe")
          : [],
      }];
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

/**
 * Builds one table-friendly API summary per deployment, contract, and allowed digest.
 */
export function getAppliedContractApiSummaries(
  deploymentsOutput: AuthListServiceDeploymentsOutput,
  instancesOutput: AuthListServiceInstancesOutput,
  contractDetails: readonly ContractDetail[] = [],
): AppliedContractApiSummary[] {
  const detailsByDigest = new Map(
    contractDetails.map((detail) => [detail.digest, detail]),
  );

  return deploymentsOutput.deployments.flatMap((deployment) =>
    deployment.appliedContracts.flatMap((applied) =>
      applied.allowedDigests.map((digest) => {
        const detail = detailsByDigest.get(digest);
        const summary = detail?.analysisSummary;
        const activeInstances = instancesOutput.instances.filter((instance) =>
          instance.deploymentId === deployment.deploymentId &&
          instance.currentContractDigest === digest &&
          !instance.disabled
        ).length;
        return {
          id: `${deployment.deploymentId}:${applied.contractId}:${digest}`,
          deploymentId: deployment.deploymentId,
          contractId: applied.contractId,
          digest,
          displayName: detail?.displayName,
          description: detail?.description,
          disabled: deployment.disabled,
          activeInstances,
          namespaces: detail?.analysisSummary?.namespaces ??
            deployment.namespaces,
          rpcMethods: summary?.rpcMethods ?? 0,
          operations: summary?.operations ?? 0,
          events: summary?.events ?? 0,
          kvResources: summary?.kvResources ?? 0,
          storeResources: summary?.storeResources ?? 0,
          jobsQueues: summary?.jobsQueues ?? 0,
          ...resourceBindingCounts(applied, digest),
        };
      })
    )
  ).sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Builds graph-friendly nodes and edges for deployments, applied contracts, and declared uses.
 */
export function getAppliedApiDependencyGraph(
  deploymentsOutput: AuthListServiceDeploymentsOutput,
  instancesOutput: AuthListServiceInstancesOutput,
  contractDetails: readonly ContractDetail[] = [],
): AppliedApiDependencyGraph {
  const detailsByDigest = new Map(
    contractDetails.map((detail) => [detail.digest, detail]),
  );
  const nodes = new Map<string, AppliedApiGraphNode>();
  const edges = new Map<string, AppliedApiGraphEdge>();
  const providersByContract = providerDeploymentIdsByContract(
    deploymentsOutput.deployments,
  );

  for (const deployment of deploymentsOutput.deployments) {
    const deploymentNodeId = `deployment:${deployment.deploymentId}`;
    nodes.set(deploymentNodeId, {
      id: deploymentNodeId,
      kind: "deployment",
      label: deployment.deploymentId,
      deploymentId: deployment.deploymentId,
      disabled: deployment.disabled,
      activeInstances: instancesOutput.instances.filter((instance) =>
        instance.deploymentId === deployment.deploymentId && !instance.disabled
      ).length,
    });

    for (const applied of deployment.appliedContracts) {
      for (const digest of applied.allowedDigests) {
        const detail = detailsByDigest.get(digest);
        const appliedNodeId = contractNodeId(applied.contractId, digest);
        nodes.set(appliedNodeId, {
          id: appliedNodeId,
          kind: "contract",
          label: detail?.displayName ?? applied.contractId,
          contractId: applied.contractId,
          digest,
        });
        edges.set(graphEdgeId("applies", deploymentNodeId, appliedNodeId), {
          id: graphEdgeId("applies", deploymentNodeId, appliedNodeId),
          source: deploymentNodeId,
          target: appliedNodeId,
          kind: "applies",
          label: "applies",
        });

        if (!detail) continue;
        for (const use of getAppliedApiUseRows(detail)) {
          const targetDeployments = providersByContract.get(use.contractId) ??
            [];
          const label = useEdgeLabel(use);
          if (targetDeployments.length > 0) {
            for (const targetDeploymentId of targetDeployments) {
              const targetNodeId = `deployment:${targetDeploymentId}`;
              const edgeId = graphEdgeId(
                "uses",
                appliedNodeId,
                targetNodeId,
                use.alias,
              );
              edges.set(edgeId, {
                id: edgeId,
                source: appliedNodeId,
                target: targetNodeId,
                kind: "uses",
                label,
              });
            }
          } else {
            const usedNodeId = contractNodeId(use.contractId);
            if (!nodes.has(usedNodeId)) {
              nodes.set(usedNodeId, {
                id: usedNodeId,
                kind: "external-contract",
                label: use.contractId,
                contractId: use.contractId,
              });
            }
            const edgeId = graphEdgeId(
              "uses",
              appliedNodeId,
              usedNodeId,
              use.alias,
            );
            edges.set(edgeId, {
              id: edgeId,
              source: appliedNodeId,
              target: usedNodeId,
              kind: "uses",
              label,
            });
          }
        }
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    edges: [...edges.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}
