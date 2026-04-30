import { ContractUseDependencyError } from "../../catalog/uses.ts";

export function getApprovalResolutionErrorMessage(
  error: unknown,
): string | null {
  if (error instanceof ContractUseDependencyError) {
    if (error.surface === "contract") {
      const state = error.reason === "unknown" ? "unknown" : "inactive";
      return `Requested app depends on ${state} contract '${error.contractId}'. Install or upgrade that service before logging in.`;
    }

    const surface = error.surface === "rpc" ? "RPC" : error.surface;
    return `Requested app depends on missing ${surface} '${error.key}' from contract '${error.contractId}'. Update the app contract or install a compatible version of that service before logging in.`;
  }

  if (!(error instanceof Error)) return null;

  const inactiveMatch = error.message.match(/inactive contract '([^']+)'/);
  if (inactiveMatch) {
    return `Requested app depends on inactive contract '${
      inactiveMatch[1]
    }'. Install or upgrade that service before logging in.`;
  }

  return null;
}
