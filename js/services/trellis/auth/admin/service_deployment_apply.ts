import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import {
  applyInstalledServiceDeploymentContract,
  type ServiceDeployment,
} from "./shared.ts";
import {
  getContractResourceAnalysis,
  preflightContractResourceCompatibility,
  provisionContractResourceBindings,
} from "../../catalog/resources.ts";
import type { ContractResourceBindings } from "../../catalog/resources.ts";

type RpcUser = { type: string; id?: string };

export type ServiceDeploymentStorage = {
  get(deploymentId: string): Promise<ServiceDeployment | undefined>;
  put(deployment: ServiceDeployment): Promise<void>;
};

type ActiveCatalogValidator = (opts: {
  extraActiveDigests?: Iterable<string>;
  stagedServiceDeployments?: Iterable<ServiceDeployment>;
}) => Promise<unknown>;

function getExistingResourceBindings(
  deployment: ServiceDeployment,
  contractId: string,
): Record<string, ContractResourceBindings> | undefined {
  const existing = deployment.appliedContracts.find((applied) =>
    applied.contractId === contractId
  )?.resourceBindingsByDigest;
  if (!existing) return undefined;

  const bindingsByDigest: Record<string, ContractResourceBindings> = {};
  for (const [digest, bindings] of Object.entries(existing)) {
    bindingsByDigest[digest] = {
      ...(bindings.kv ? { kv: bindings.kv } : {}),
      ...(bindings.store ? { store: bindings.store } : {}),
    };
  }
  return bindingsByDigest;
}

function invalid(
  path: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return Result.err(
    new ValidationError({
      errors: [{ path, message }],
      ...(context ? { context } : {}),
    }),
  );
}

/** Creates the Auth.ApplyServiceDeploymentContract handler with injectable storage. */
export function createAuthApplyServiceDeploymentContractHandler(deps: {
  installServiceContract: (contract: unknown) => Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
    usedNamespaces: string[];
    contract: TrellisContractV1;
  }>;
  nats?: NatsConnection;
  provisionResourceBindings?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
  ) => Promise<ContractResourceBindings>;
  refreshActiveContracts: () => Promise<void>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  validateActiveCatalog?: ActiveCatalogValidator;
}) {
  return async (
    {
      input: req,
    }: {
      input: { deploymentId: string; contract: unknown };
      context: { caller: RpcUser };
    },
  ) => {
    const deployment = await deps.serviceDeploymentStorage.get(
      req.deploymentId,
    );
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }

    const installed = await deps.installServiceContract(req.contract);
    try {
      const analysis = getContractResourceAnalysis(installed.contract);
      preflightContractResourceCompatibility({
        serviceDeploymentId: deployment.deploymentId,
        contractId: installed.id,
        proposedDigest: installed.digest,
        proposed: { kv: analysis.kv, store: analysis.store },
        existingBindingsByDigest: getExistingResourceBindings(
          deployment,
          installed.id,
        ),
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    if (deps.validateActiveCatalog) {
      try {
        await deps.validateActiveCatalog({
          extraActiveDigests: [installed.digest],
        });
      } catch (error) {
        return Result.err(new UnexpectedError({ cause: toError(error) }));
      }
    }

    let resourceBindings;
    try {
      resourceBindings = await (deps.provisionResourceBindings ??
        provisionContractResourceBindings)(
          deps.nats,
          installed.contract,
          deployment.deploymentId,
        );
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const nextDeployment = applyInstalledServiceDeploymentContract(
      deployment,
      { ...installed, resourceBindings },
    );
    if (deps.validateActiveCatalog) {
      try {
        await deps.validateActiveCatalog({
          stagedServiceDeployments: [nextDeployment],
        });
      } catch (error) {
        return Result.err(new UnexpectedError({ cause: toError(error) }));
      }
    }

    try {
      await deps.serviceDeploymentStorage.put(nextDeployment);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    try {
      await deps.refreshActiveContracts();
    } catch (error) {
      try {
        await deps.serviceDeploymentStorage.put(deployment);
      } catch (rollbackError) {
        return Result.err(
          new UnexpectedError({
            cause: new AggregateError(
              [toError(error), toError(rollbackError)],
              "active catalog refresh failed and service deployment rollback failed",
            ),
          }),
        );
      }
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    return Result.ok({
      deployment: nextDeployment,
      contract: {
        digest: installed.digest,
        id: installed.id,
        displayName: installed.displayName,
        description: installed.description,
        installedAt: new Date().toISOString(),
      },
    });
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
