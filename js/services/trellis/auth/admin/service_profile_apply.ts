import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";

import {
  applyInstalledServiceProfileContract,
  type ServiceProfile,
} from "./shared.ts";

type RpcUser = { type: string; id?: string };

export type ServiceProfileStorage = {
  get(profileId: string): Promise<ServiceProfile | undefined>;
  put(profile: ServiceProfile): Promise<void>;
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

/** Creates the Auth.ApplyServiceProfileContract handler with injectable storage. */
export function createAuthApplyServiceProfileContractHandler(deps: {
  installServiceContract: (contract: unknown) => Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
    usedNamespaces: string[];
  }>;
  refreshActiveContracts: () => Promise<void>;
  serviceProfileStorage: ServiceProfileStorage;
}) {
  return async (
    {
      input: req,
    }: {
      input: { profileId: string; contract: unknown };
      context: { caller: RpcUser };
    },
  ) => {
    const profile = await deps.serviceProfileStorage.get(req.profileId);
    if (!profile) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }

    const installed = await deps.installServiceContract(req.contract);
    const nextProfile = applyInstalledServiceProfileContract(
      profile,
      installed,
    );
    try {
      await deps.serviceProfileStorage.put(nextProfile);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    try {
      await deps.refreshActiveContracts();
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    return Result.ok({
      profile: nextProfile,
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
