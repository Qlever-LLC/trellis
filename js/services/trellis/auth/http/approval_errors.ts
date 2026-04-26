export function getApprovalResolutionErrorMessage(
  error: unknown,
): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const inactiveMatch = error.message.match(/inactive contract '([^']+)'/);
  if (inactiveMatch) {
    return `Requested app depends on inactive contract '${
      inactiveMatch[1]
    }'. Install or upgrade that service before logging in.`;
  }

  return null;
}
