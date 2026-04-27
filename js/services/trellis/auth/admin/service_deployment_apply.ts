import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";

import {
  applyInstalledServiceDeploymentContract,
  type ServiceDeployment,
} from "./shared.ts";

type RpcUser = { type: string; id?: string };

export type ServiceDeploymentStorage = {
  get(deploymentId: string): Promise<ServiceDeployment | undefined>;
  put(deployment: ServiceDeployment): Promise<void>;
};

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
  }>;
  refreshActiveContracts: () => Promise<void>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
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
    const nextDeployment = applyInstalledServiceDeploymentContract(
      deployment,
      installed,
    );
    try {
      await deps.serviceDeploymentStorage.put(nextDeployment);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    try {
      await deps.refreshActiveContracts();
    } catch (error) {
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
