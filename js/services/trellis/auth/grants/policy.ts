import type { IdentityEnvelopeRecord } from "../schemas.ts";

export type EffectiveApproval =
  | { kind: "stored_approval"; answer: "approved" | "denied" }
  | { kind: "deployment_grant"; answer: "approved" }
  | { kind: "none"; answer: "none" };

export function getAppOrigin(redirectTo: string): string | undefined {
  try {
    return new URL(redirectTo).origin;
  } catch {
    return undefined;
  }
}

export function effectiveApproval(args: {
  storedApproval: IdentityEnvelopeRecord | null;
  deploymentGrantApproved?: boolean;
  matchedPolicies: [];
}): EffectiveApproval {
  if (args.storedApproval) {
    return {
      kind: "stored_approval",
      answer: args.storedApproval.answer,
    };
  }
  if (args.deploymentGrantApproved) {
    return { kind: "deployment_grant", answer: "approved" };
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
  storedApproval: IdentityEnvelopeRecord | null;
  matchedPolicies: [];
}): boolean {
  if (!args.active) return false;
  const resolvedApproval = effectiveApproval({
    storedApproval: args.storedApproval,
    matchedPolicies: args.matchedPolicies,
  });
  return resolvedApproval.answer === "approved" &&
    args.delegatedCapabilities.every((capability) =>
      args.explicitCapabilities.includes(capability)
    );
}
