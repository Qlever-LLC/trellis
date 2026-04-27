import type {
  ContractApprovalRecord,
  InstanceGrantPolicy,
  PortalProfile,
} from "../../state/schemas.ts";

export type EffectiveApproval =
  | { kind: "admin_policy"; answer: "approved" }
  | { kind: "portal_profile"; answer: "approved" }
  | { kind: "stored_approval"; answer: "approved" | "denied" }
  | { kind: "none"; answer: "none" };

function sortUniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function getAppOrigin(redirectTo: string): string | undefined {
  try {
    return new URL(redirectTo).origin;
  } catch {
    return undefined;
  }
}

export function matchesInstanceGrantPolicy(args: {
  policy: InstanceGrantPolicy;
  contractId: string;
  appOrigin?: string;
}): boolean {
  if (args.policy.disabled) return false;
  if (args.policy.contractId !== args.contractId) return false;
  const allowedOrigins = args.policy.allowedOrigins ?? [];
  if (allowedOrigins.length === 0) return true;
  return args.appOrigin !== undefined &&
    allowedOrigins.includes(args.appOrigin);
}

export function matchingInstanceGrantPolicies(args: {
  policies: InstanceGrantPolicy[];
  contractId: string;
  appOrigin?: string;
}): InstanceGrantPolicy[] {
  return args.policies.filter((policy) =>
    matchesInstanceGrantPolicy({
      policy,
      contractId: args.contractId,
      appOrigin: args.appOrigin,
    })
  );
}

export function portalProfileToGrantPolicy(
  deployment: PortalProfile,
): InstanceGrantPolicy {
  return {
    contractId: deployment.contractId,
    ...(deployment.allowedOrigins
      ? { allowedOrigins: deployment.allowedOrigins }
      : {}),
    impliedCapabilities: deployment.impliedCapabilities,
    disabled: deployment.disabled,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
    source: {
      kind: "portal_profile",
      portalId: deployment.portalId,
      entryUrl: deployment.entryUrl,
    },
  };
}

function policyApprovalSource(
  policies: InstanceGrantPolicy[],
): "admin_policy" | "portal_profile" {
  if (policies.some((policy) => policy.source.kind === "portal_profile")) {
    return "portal_profile";
  }
  return "admin_policy";
}

export function effectiveCapabilities(args: {
  explicitCapabilities: string[];
  matchedPolicies: InstanceGrantPolicy[];
}): string[] {
  return sortUniqueStrings([
    ...args.explicitCapabilities,
    ...args.matchedPolicies.flatMap((policy) => policy.impliedCapabilities),
  ]);
}

export function effectiveApproval(args: {
  storedApproval: ContractApprovalRecord | null;
  matchedPolicies: InstanceGrantPolicy[];
}): EffectiveApproval {
  if (args.matchedPolicies.length > 0) {
    return {
      kind: policyApprovalSource(args.matchedPolicies),
      answer: "approved",
    };
  }
  if (args.storedApproval) {
    return {
      kind: "stored_approval",
      answer: args.storedApproval.answer,
    };
  }
  return { kind: "none", answer: "none" };
}

export function missingCapabilities(args: {
  requiredCapabilities: string[];
  effectiveCapabilities: string[];
}): string[] {
  return args.requiredCapabilities.filter((capability) =>
    !args.effectiveCapabilities.includes(capability)
  );
}

export function userDelegationAllowed(args: {
  active: boolean;
  explicitCapabilities: string[];
  delegatedCapabilities: string[];
  storedApproval: ContractApprovalRecord | null;
  matchedPolicies: InstanceGrantPolicy[];
}): boolean {
  if (!args.active) return false;
  const resolvedCapabilities = effectiveCapabilities({
    explicitCapabilities: args.explicitCapabilities,
    matchedPolicies: args.matchedPolicies,
  });
  const resolvedApproval = effectiveApproval({
    storedApproval: args.storedApproval,
    matchedPolicies: args.matchedPolicies,
  });
  return resolvedApproval.answer === "approved" &&
    args.delegatedCapabilities.every((capability) =>
      resolvedCapabilities.includes(capability)
    );
}
